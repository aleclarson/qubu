import type {
  SnapshotDiff,
  SnapshotDiffDiagnostic,
  SnapshotDiffEvidence,
  SnapshotDiffObject,
  SnapshotDiffObjectKind,
  SnapshotDiffOperation,
  SnapshotDiffPath,
} from "qubu/diff"
import { canonicalJson, toSnapshotJsonValue } from "qubu/snapshot"
import type { SnapshotDialect, SnapshotJsonValue } from "qubu/snapshot"

import {
  migrationPlanFormat,
  migrationPlanVersion,
  MigrationPlanValidationError,
  type MigrationCustomSql,
  type MigrationCustomSqlInput,
  type MigrationDecision,
  type MigrationDependency,
  type MigrationDiagnostic,
  type MigrationDiagnosticCode,
  type MigrationLockRequirement,
  type MigrationOperation,
  type MigrationOperationOrigin,
  type MigrationOperationType,
  type MigrationPlan,
  type MigrationPlanDecodeResult,
  type MigrationPlanOptions,
  type MigrationPlanResult,
  type MigrationPlanValidationResult,
  type MigrationPrecondition,
  type MigrationSafety,
  type MigrationTransactionRequirement,
} from "./types.ts"

interface PlannedContext {
  readonly source?: SnapshotDiffOperation
  operation: MigrationOperation
}

const objectKinds = new Set<SnapshotDiffObjectKind>([
  "namespace",
  "table",
  "column",
  "constraint",
  "index",
  "view",
  "materialized-view",
  "sequence",
  "enum",
  "domain",
  "collation",
  "trigger",
  "routine",
  "partition",
  "policy",
  "extension",
  "comment",
  "ownership",
  "deferred-object",
  "opaque-object",
])

const safetyValues = new Set<MigrationSafety>([
  "safe",
  "review-required",
  "destructive",
  "unsupported",
  "unknown",
])

const operationValues = new Set<MigrationOperationType>([
  "add",
  "remove",
  "property-change",
  "physical-rename",
  "custom-sql",
])

const lockValues = new Set<MigrationLockRequirement>(["none", "shared", "exclusive", "unknown"])

const transactionValues = new Set<MigrationTransactionRequirement>([
  "required",
  "optional",
  "forbidden",
  "unknown",
])

const reversibilityValues = new Set(["reversible", "irreversible"])

const dependencyReasons = new Set<MigrationDependency["reason"]>([
  "parent-before-child",
  "child-before-parent",
  "reference-before-dependent",
  "explicit-custom-sql",
])

const safetyRank: Record<MigrationSafety, number> = {
  safe: 0,
  "review-required": 1,
  destructive: 2,
  unsupported: 3,
  unknown: 4,
}

/**
 * Convert a resolved SnapshotDiff into an immutable migration plan.
 *
 * This function only describes operations. It does not render SQL, open a connection, execute a
 * transaction, or infer SQL from opaque snapshot data. A plan that still needs a safety decision is
 * returned with `ok: false` so it can be reviewed without being mistaken for an executable plan.
 */
export function createMigrationPlan(
  diff: SnapshotDiff,
  options: MigrationPlanOptions = {},
): MigrationPlanResult {
  const diagnostics: MigrationDiagnostic[] = []
  const dialect = diff.afterDialect ?? diff.beforeDialect

  if (dialect === undefined) {
    diagnostics.push(
      planDiagnostic(
        "invalid-plan",
        "A migration plan needs a source or target snapshot dialect",
        [],
      ),
    )
  }

  if (
    diff.beforeDialect !== undefined &&
    diff.afterDialect !== undefined &&
    diff.beforeDialect.name !== diff.afterDialect.name
  ) {
    diagnostics.push(
      planDiagnostic(
        "dialect-mismatch",
        `A migration plan cannot span dialects "${diff.beforeDialect.name}" and "${diff.afterDialect.name}"`,
        [],
        { dialect: diff.afterDialect },
      ),
    )
  }

  const sourceDiagnostics = diff.diagnostics.map(mapDiffDiagnostic)

  diagnostics.push(...sourceDiagnostics)
  const decisions = normalizeDecisions(options.decisions, diagnostics)
  const contexts: PlannedContext[] = []
  const operationIds = new Set<string>()
  const operationTargets = new Map<string, PlannedContext>()

  for (const source of diff.operations) {
    const id = operationId(source)

    if (operationIds.has(id)) {
      diagnostics.push(
        planDiagnostic(
          "invalid-plan",
          `Diff operations produced duplicate migration ID "${id}"`,
          sourcePath(source),
          sourceContext(source),
        ),
      )
      continue
    }

    operationIds.add(id)
    const safety = classifySafety(source, diff.diagnostics)
    const context: PlannedContext = {
      source,
      operation: makeOperation(id, source, safety, dialect ?? neutralDialect, 0),
    }

    contexts.push(context)
    operationTargets.set(targetKeyFromSource(source), context)
  }

  const customContexts = addCustomSql(
    contexts,
    operationIds,
    operationTargets,
    options.customSql,
    dialect ?? neutralDialect,
    diagnostics,
  )

  contexts.push(...customContexts)

  const approvedDecisions: MigrationDecision[] = [...decisions]

  for (const context of contexts) {
    const safety = context.operation.safety
    const explicit = findDecision(context, decisions, diff.diagnostics, options)
    const optionAllowed = optionAllows(safety, options)
    let status: MigrationOperation["status"] = "approved"
    let decision = explicit

    if (explicit?.action === "skip") {
      status = "skipped"
    } else if (explicit?.action === "allow" || optionAllowed) {
      status = "approved"
      if (explicit === undefined && optionAllowed) {
        decision = {
          action: "allow",
          reason: `Allowed by migration plan option for ${safety} facts`,
          operationId: context.operation.id,
        }
        approvedDecisions.push(decision)
      }
    } else if (safety !== "safe") {
      status = "decision-required"
      diagnostics.push(
        planDiagnostic(
          "decision-required",
          `Operation "${context.operation.id}" has ${safety} safety and needs an explicit decision`,
          context.operation.path,
          {
            operationId: context.operation.id,
            kind: context.operation.kind,
            namespace: context.operation.namespace,
            logicalId: context.operation.logicalId,
            physicalName: context.operation.physicalName,
            dialect: context.operation.dialect,
            evidence: context.operation.evidence,
          },
        ),
      )
    }

    context.operation = updateOperation(context.operation, {
      status,
      decision,
    })
  }

  requireDecisionsForUnmatchedDiagnostics(
    diff.diagnostics,
    contexts,
    decisions,
    options,
    diagnostics,
  )

  const dependencyResult = buildDependencies(contexts, diagnostics)
  const ordered = topologicalOrder(contexts, dependencyResult, diagnostics)
  const operations = ordered.map((context, position) =>
    updateOperation(context.operation, {
      position,
      dependsOn: dependencyResult.byOperation.get(context.operation.id) ?? [],
    }),
  )
  const dependencies = dependencyResult.edges
  const planDiagnostics = sortDiagnostics(diagnostics)
  const safety = highestSafety(operations)
  const ready =
    planDiagnostics.every((item) => item.severity !== "error") &&
    operations.every((operation) => operation.status !== "decision-required")
  const plan = freezePlan({
    format: migrationPlanFormat,
    version: migrationPlanVersion,
    dialect: dialect ?? neutralDialect,
    ...(diff.beforeFingerprint === undefined ? {} : { beforeFingerprint: diff.beforeFingerprint }),
    ...(diff.afterFingerprint === undefined ? {} : { afterFingerprint: diff.afterFingerprint }),
    safety,
    ready,
    operations,
    dependencies,
    decisions: sortDecisions(approvedDecisions),
    diagnostics: planDiagnostics,
  })

  return ready
    ? {
        ok: true,
        plan,
        diagnostics: planDiagnostics,
      }
    : {
        ok: false,
        plan,
        diagnostics: planDiagnostics,
      }
}

/** Alias for callers that treat plan creation as the main migration action. */
export const planMigration = createMigrationPlan
export const createPlan = createMigrationPlan

/** Build a plan or throw one structured validation error when it is blocked. */
export function assertMigrationPlanFromDiff(
  diff: SnapshotDiff,
  options: MigrationPlanOptions = {},
): MigrationPlan {
  const result = createMigrationPlan(diff, options)

  if (!result.ok) {
    throw new MigrationPlanValidationError(result.diagnostics)
  }

  return result.plan
}

/** Return a fixed-order immutable plan after strict validation. */
export function canonicalizeMigrationPlan(input: MigrationPlan): MigrationPlan {
  return assertMigrationPlan(input)
}

/** Encode a validated plan as deterministic JSON. */
export function encodeMigrationPlan(input: MigrationPlan): string {
  return canonicalJson(toSnapshotJsonValue(assertMigrationPlan(input)))
}

/** Decode and strictly validate a migration-plan JSON value. */
export function decodeMigrationPlan(input: string | unknown): MigrationPlanDecodeResult {
  let value: unknown = input

  if (typeof input === "string") {
    try {
      value = JSON.parse(input) as unknown
    } catch (error) {
      return {
        ok: false,
        diagnostics: freeze([
          planDiagnostic(
            "invalid-plan",
            `Migration plan JSON could not be parsed: ${
              error instanceof Error ? error.message : String(error)
            }`,
            [],
          ),
        ]),
      }
    }
  }

  const validation = validatePlanValue(value)

  if (!validation.ok) {
    return validation
  }

  return {
    ok: true,
    value: validation.value,
  }
}

/** Validate a plan without throwing. */
export function validateMigrationPlan(input: unknown): MigrationPlanValidationResult {
  return decodeMigrationPlan(input)
}

/** Validate a plan and throw one structured error on failure. */
export function assertMigrationPlan(input: unknown): MigrationPlan {
  const result = validatePlanValue(input)

  if (!result.ok) {
    throw new MigrationPlanValidationError(result.diagnostics)
  }

  return result.value
}

/** Compute a deterministic fingerprint for cache keys and fixture assertions. */
export function migrationPlanFingerprint(input: MigrationPlan | string): string {
  const plan =
    typeof input === "string"
      ? decodeMigrationPlan(input)
      : {
          ok: true as const,
          value: assertMigrationPlan(input),
        }

  if (!plan.ok) {
    throw new MigrationPlanValidationError(plan.diagnostics)
  }

  const source = encodeMigrationPlan(plan.value)

  return fingerprintText(source)
}

export const encodePlan = encodeMigrationPlan
export const decodePlan = decodeMigrationPlan
export const assertPlan = assertMigrationPlan
export const fingerprintMigrationPlan = migrationPlanFingerprint

const neutralDialect: SnapshotDialect = Object.freeze({
  name: "neutral",
  version: 1,
})

function makeOperation(
  id: string,
  source: SnapshotDiffOperation,
  safety: MigrationSafety,
  dialect: SnapshotDialect,
  position: number,
): MigrationOperation {
  const origin: MigrationOperationOrigin = {
    type: source.type,
    kind: source.objectKind,
    ...(source.namespace === undefined ? {} : { namespace: source.namespace }),
    path: source.path,
    ...(source.logicalId === undefined ? {} : { logicalId: source.logicalId }),
    ...(source.physicalName === undefined ? {} : { physicalName: source.physicalName }),
    ...(source.physicalReference === undefined
      ? {}
      : { physicalReference: source.physicalReference }),
    ...(source.provenance === undefined ? {} : { provenance: source.provenance }),
    ...(source.before === undefined ? {} : { before: source.before }),
    ...(source.after === undefined ? {} : { after: source.after }),
    evidence: source.evidence,
  }
  const reversible = source.type !== "remove"
  const preconditions = preconditionsFor(source)

  return {
    id,
    type: source.type,
    kind: source.objectKind,
    objectKind: source.objectKind,
    ...(source.namespace === undefined ? {} : { namespace: source.namespace }),
    path: source.path,
    ...(source.logicalId === undefined ? {} : { logicalId: source.logicalId }),
    ...(source.physicalName === undefined ? {} : { physicalName: source.physicalName }),
    ...(source.physicalReference === undefined
      ? {}
      : { physicalReference: source.physicalReference }),
    ...(source.provenance === undefined ? {} : { provenance: source.provenance }),
    dialect,
    safety,
    lock: lockFor(source),
    transaction: transactionFor(source),
    reversible,
    reversibility: reversible ? "reversible" : "irreversible",
    ...(reversible
      ? {}
      : {
          irreversibleReason:
            "Removing an existing object cannot be reversed without retained data",
        }),
    preconditions,
    dependsOn: [],
    evidence: source.evidence,
    origin,
    status: "approved",
    position,
  }
}

function preconditionsFor(source: SnapshotDiffOperation): readonly MigrationPrecondition[] {
  const object = source.before ?? source.after
  const base = {
    path: source.path,
    kind: source.objectKind,
    ...(source.namespace === undefined ? {} : { namespace: source.namespace }),
    ...(source.logicalId === undefined ? {} : { logicalId: source.logicalId }),
    ...(source.physicalName === undefined ? {} : { physicalName: source.physicalName }),
  }

  if (source.type === "add") {
    return [
      {
        ...base,
        type: "object-absent",
      },
    ]
  }

  if (source.type === "remove") {
    return [
      {
        ...base,
        type: "object-present",
        ...(object === undefined ? {} : { fingerprint: fingerprintJson(object.value) }),
      },
    ]
  }

  const result: MigrationPrecondition[] = [
    {
      ...base,
      type: "object-present",
      ...(source.before === undefined ? {} : { fingerprint: fingerprintJson(source.before.value) }),
    },
  ]

  if (source.type === "property-change") {
    for (const change of source.changedProperties ?? []) {
      if (change.before !== undefined) {
        result.push({
          ...base,
          type: "property-equals",
          property: change.path,
          value: change.before,
        })
      }
    }
  }

  return result
}

function lockFor(source: SnapshotDiffOperation): MigrationLockRequirement {
  if (source.kind === "comment" || source.kind === "ownership") {
    return "shared"
  }

  if (source.type === "add") {
    return "exclusive"
  }

  if (source.type === "remove") {
    return "exclusive"
  }

  if (source.type === "physical-rename") {
    return "exclusive"
  }

  return source.destructive ? "exclusive" : "shared"
}

function transactionFor(source: SnapshotDiffOperation): MigrationTransactionRequirement {
  if (source.kind === "opaque-object" || source.kind === "deferred-object") {
    return "unknown"
  }

  if (source.type === "remove" || source.destructive) {
    return "required"
  }

  if (source.type === "physical-rename") {
    return "optional"
  }

  return "optional"
}

function classifySafety(
  source: SnapshotDiffOperation,
  diagnostics: readonly SnapshotDiffDiagnostic[],
): MigrationSafety {
  const relevant = diagnostics.filter((diagnostic) => pathRelated(diagnostic.path, source.path))

  if (
    relevant.some((diagnostic) => diagnostic.code === "unknown" || diagnostic.code === "lossy") ||
    source.kind === "opaque-object" ||
    source.kind === "deferred-object"
  ) {
    return "unknown"
  }

  if (relevant.some((diagnostic) => diagnostic.code === "unsupported")) {
    return "unsupported"
  }

  if (source.destructive || relevant.some((diagnostic) => diagnostic.code === "destructive")) {
    return "destructive"
  }

  if (
    source.type === "physical-rename" ||
    source.type === "property-change" ||
    relevant.some((diagnostic) => diagnostic.code === "ambiguous")
  ) {
    return "review-required"
  }

  return "safe"
}

function addCustomSql(
  contexts: readonly PlannedContext[],
  operationIds: Set<string>,
  targets: Map<string, PlannedContext>,
  inputs: readonly MigrationCustomSqlInput[] | undefined,
  dialect: SnapshotDialect,
  diagnostics: MigrationDiagnostic[],
): PlannedContext[] {
  if (inputs === undefined) {
    return []
  }

  const result: PlannedContext[] = []

  for (const [index, input] of inputs.entries()) {
    if (!isRecord(input)) {
      diagnostics.push(
        planDiagnostic("custom-sql", "Custom SQL input must be an object", ["customSql", index]),
      )
      continue
    }

    const candidate = input as unknown as Record<string, unknown>

    if (typeof candidate.sql !== "string" || candidate.sql.length === 0) {
      diagnostics.push(
        planDiagnostic("custom-sql", "Custom SQL must be a non-empty string", [
          "customSql",
          index,
          "sql",
        ]),
      )
      continue
    }

    if (!isDialect(candidate.dialect)) {
      diagnostics.push(
        planDiagnostic("custom-sql", "Custom SQL needs a dialect descriptor", [
          "customSql",
          index,
          "dialect",
        ]),
      )
      continue
    }

    if (
      !isSafety(candidate.safety) ||
      typeof candidate.reason !== "string" ||
      candidate.reason.length === 0
    ) {
      diagnostics.push(
        planDiagnostic("custom-sql", "Custom SQL needs a safety classification and reason", [
          "customSql",
          index,
        ]),
      )
      continue
    }

    if (candidate.position !== undefined && !validPosition(candidate.position)) {
      diagnostics.push(
        planDiagnostic("custom-sql", "Custom SQL position must be a non-negative integer", [
          "customSql",
          index,
          "position",
        ]),
      )
      continue
    }

    if (candidate.reversible !== undefined && typeof candidate.reversible !== "boolean") {
      diagnostics.push(
        planDiagnostic("custom-sql", "Custom SQL reversible must be boolean", [
          "customSql",
          index,
          "reversible",
        ]),
      )
      continue
    }

    if (
      candidate.dependsOn !== undefined &&
      (!Array.isArray(candidate.dependsOn) ||
        !candidate.dependsOn.every((dependency) => typeof dependency === "string"))
    ) {
      diagnostics.push(
        planDiagnostic("custom-sql", "Custom SQL dependsOn must contain operation IDs", [
          "customSql",
          index,
          "dependsOn",
        ]),
      )
      continue
    }

    if (candidate.path !== undefined && !isPath(candidate.path)) {
      diagnostics.push(
        planDiagnostic("custom-sql", "Custom SQL path must be an array", [
          "customSql",
          index,
          "path",
        ]),
      )
      continue
    }

    if (candidate.kind !== undefined && !isObjectKind(candidate.kind)) {
      diagnostics.push(
        planDiagnostic("custom-sql", "Custom SQL kind is invalid", ["customSql", index, "kind"]),
      )
      continue
    }

    if (candidate.namespace !== undefined && typeof candidate.namespace !== "string") {
      diagnostics.push(
        planDiagnostic("custom-sql", "Custom SQL namespace must be a string", [
          "customSql",
          index,
          "namespace",
        ]),
      )
      continue
    }

    if (candidate.operationId !== undefined && typeof candidate.operationId !== "string") {
      diagnostics.push(
        planDiagnostic("custom-sql", "Custom SQL operationId must be a string", [
          "customSql",
          index,
          "operationId",
        ]),
      )
      continue
    }

    const normalized: MigrationCustomSqlInput = {
      sql: candidate.sql,
      dialect: candidate.dialect,
      safety: candidate.safety,
      reason: candidate.reason,
      ...(candidate.reversible === undefined ? {} : { reversible: candidate.reversible }),
      ...(candidate.operationId === undefined ? {} : { operationId: candidate.operationId }),
      ...(candidate.kind === undefined ? {} : { kind: candidate.kind }),
      ...(candidate.namespace === undefined ? {} : { namespace: candidate.namespace }),
      ...(candidate.path === undefined ? {} : { path: candidate.path }),
      ...(candidate.position === undefined ? {} : { position: candidate.position }),
      ...(candidate.dependsOn === undefined ? {} : { dependsOn: candidate.dependsOn }),
    }

    if (normalized.dialect.name !== dialect.name) {
      diagnostics.push(
        planDiagnostic(
          "dialect-mismatch",
          `Custom SQL dialect "${normalized.dialect.name}" does not match plan dialect "${dialect.name}"`,
          ["customSql", index, "dialect"],
          { dialect: normalized.dialect },
        ),
      )
    }

    const target = resolveCustomTarget(normalized, targets)

    if (normalized.operationId !== undefined && target === undefined) {
      diagnostics.push(
        planDiagnostic(
          "custom-sql",
          `Custom SQL target operation "${normalized.operationId}" does not exist`,
          ["customSql", index, "operationId"],
        ),
      )
    }

    const id = customOperationId(normalized, index)

    if (operationIds.has(id)) {
      diagnostics.push(
        planDiagnostic("custom-sql", `Duplicate custom SQL operation ID "${id}"`, [
          "customSql",
          index,
        ]),
      )
      continue
    }

    operationIds.add(id)
    const targetObject = target?.operation.origin?.after ?? target?.operation.origin?.before
    const path = normalized.path ?? targetObject?.path ?? []
    const namespace = normalized.namespace ?? targetObject?.namespace
    const logicalId = targetObject?.id
    const customSql: MigrationCustomSql = {
      sql: normalized.sql,
      dialect: normalized.dialect,
      safety: normalized.safety,
      position: normalized.position ?? contexts.length + index,
      reason: normalized.reason,
      reversible: normalized.reversible ?? false,
    }
    const operation: MigrationOperation = {
      id,
      type: "custom-sql",
      kind: "custom-sql",
      objectKind: "custom-sql",
      ...(namespace === undefined ? {} : { namespace }),
      path,
      ...(logicalId === undefined ? {} : { logicalId }),
      dialect: normalized.dialect,
      safety: normalized.safety,
      lock: normalized.safety === "safe" ? "shared" : "exclusive",
      transaction: "optional",
      reversible: customSql.reversible,
      reversibility: customSql.reversible ? "reversible" : "irreversible",
      ...(customSql.reversible
        ? {}
        : {
            irreversibleReason: "Custom SQL has no declared reverse operation",
          }),
      preconditions: [],
      dependsOn: [
        ...new Set([
          ...(normalized.dependsOn ?? []),
          ...(target === undefined ? [] : [target.operation.id]),
        ]),
      ].sort(),
      ...(targetObject?.physicalReference === undefined
        ? {}
        : { physicalReference: targetObject.physicalReference }),
      ...(targetObject?.provenance === undefined ? {} : { provenance: targetObject.provenance }),
      evidence: target?.operation.evidence ?? [],
      customSql,
      status: "approved",
      position: 0,
    }
    const context: PlannedContext = { operation }

    result.push(context)
    if (target !== undefined && targetObject !== undefined) {
      targets.set(targetKeyFromObject(targetObject), target)
    }
  }

  return result
}

function resolveCustomTarget(
  input: MigrationCustomSqlInput,
  targets: ReadonlyMap<string, PlannedContext>,
): PlannedContext | undefined {
  if (input.operationId !== undefined) {
    for (const target of targets.values()) {
      if (target.operation.id === input.operationId) {
        return target
      }
    }
  }

  if (input.kind !== undefined && input.path !== undefined) {
    for (const target of targets.values()) {
      if (
        target.operation.kind === input.kind &&
        target.operation.namespace === input.namespace &&
        samePath(target.operation.path, input.path)
      ) {
        return target
      }
    }
  }

  return undefined
}

function findDecision(
  context: PlannedContext,
  decisions: readonly MigrationDecision[],
  diagnostics: readonly SnapshotDiffDiagnostic[],
  options: MigrationPlanOptions,
): MigrationDecision | undefined {
  const direct = decisions.find((decision) => {
    if (decision.operationId === context.operation.id) {
      return true
    }

    if (
      decision.kind !== undefined &&
      decision.kind === context.operation.kind &&
      (decision.namespace === undefined || decision.namespace === context.operation.namespace) &&
      (decision.path === undefined || samePath(decision.path, context.operation.path))
    ) {
      return true
    }

    return false
  })

  if (direct !== undefined) {
    return direct
  }

  const relevantCode = diagnostics.find((diagnostic) =>
    pathRelated(diagnostic.path, context.operation.path),
  )?.code

  if (relevantCode !== undefined) {
    return decisions.find((decision) => decision.code === mapDiffCode(relevantCode))
  }

  if (optionAllows(context.operation.safety, options)) {
    return undefined
  }

  return undefined
}

function requireDecisionsForUnmatchedDiagnostics(
  diagnostics: readonly SnapshotDiffDiagnostic[],
  contexts: readonly PlannedContext[],
  decisions: readonly MigrationDecision[],
  options: MigrationPlanOptions,
  planDiagnostics: MigrationDiagnostic[],
): void {
  for (const source of diagnostics) {
    if (source.code !== "unknown" && source.code !== "lossy" && source.code !== "unsupported") {
      continue
    }

    const hasOperation = contexts.some((context) =>
      pathRelated(source.path, context.operation.path),
    )
    const safety = source.code === "lossy" ? "unknown" : source.code

    if (hasOperation || optionAllows(safety, options)) {
      continue
    }

    const decision = decisions.find(
      (item) =>
        item.code === mapDiffCode(source.code) &&
        (item.path === undefined || samePath(item.path, source.path)),
    )

    if (decision !== undefined) {
      continue
    }

    planDiagnostics.push(
      planDiagnostic(
        mapDiffCode(source.code),
        `Diff diagnostic "${source.code}" needs an explicit migration decision`,
        source.path,
        {
          kind: source.objectKind ?? source.kind,
          namespace: source.namespace,
          logicalId: source.logicalId,
          physicalName: source.physicalName,
          dialect: source.dialect,
          evidence: source.evidence,
          source,
        },
      ),
    )
  }
}

function buildDependencies(
  contexts: readonly PlannedContext[],
  diagnostics: MigrationDiagnostic[],
): {
  readonly edges: readonly MigrationDependency[]
  readonly byOperation: ReadonlyMap<string, readonly string[]>
} {
  const edges: MigrationDependency[] = []
  const edgeKeys = new Set<string>()
  const byObject = new Map<string, PlannedContext>()

  for (const context of contexts) {
    const object = context.operation.origin?.after ?? context.operation.origin?.before

    if (object !== undefined) {
      byObject.set(targetKeyFromObject(object), context)
    }
  }

  const addEdge = (
    from: MigrationOperation,
    to: MigrationOperation,
    reason: MigrationDependency["reason"],
  ): void => {
    if (from.id === to.id) {
      return
    }

    const key = `${from.id}\u0000${to.id}\u0000${reason}`

    if (edgeKeys.has(key)) {
      return
    }

    edgeKeys.add(key)
    edges.push({
      from: from.id,
      to: to.id,
      reason,
    })
  }

  for (const context of contexts) {
    const operation = context.operation
    const object = operation.origin?.after ?? operation.origin?.before
    const parent = object?.parent

    if (parent !== undefined && object !== undefined) {
      const parentContext = byObject.get(targetKeyFromReference(parent, object.namespace))

      if (parentContext !== undefined) {
        if (operation.type === "remove") {
          addEdge(operation, parentContext.operation, "child-before-parent")
        } else {
          addEdge(parentContext.operation, operation, "parent-before-child")
        }
      }
    }

    if (operation.type !== "remove" && object !== undefined) {
      for (const reference of referencedObjects(object.value)) {
        const referenceContext = byObject.get(targetKeyFromReference(reference, object.namespace))

        if (referenceContext !== undefined) {
          addEdge(referenceContext.operation, operation, "reference-before-dependent")
        }
      }

      if (operation.dialect.name === "postgresql") {
        for (const nativeType of postgresNativeTypes(object.value)) {
          const referenceContext = contexts.find((candidate) => {
            const reference = candidate.operation.origin?.after

            return (
              candidate.operation.type === "add" &&
              candidate.operation.kind === "enum" &&
              reference !== undefined &&
              postgresTypeMatches(nativeType, reference.physicalName, reference.namespace)
            )
          })

          if (referenceContext !== undefined) {
            addEdge(referenceContext.operation, operation, "reference-before-dependent")
          }
        }
      }
    }
  }

  for (const context of contexts) {
    for (const dependency of context.operation.dependsOn) {
      const target = contexts.find((item) => item.operation.id === dependency)

      if (target === undefined) {
        diagnostics.push(
          planDiagnostic(
            "custom-sql",
            `Operation "${context.operation.id}" depends on unknown operation "${dependency}"`,
            context.operation.path,
            { operationId: context.operation.id },
          ),
        )
        continue
      }

      addEdge(target.operation, context.operation, "explicit-custom-sql")
    }
  }

  const byOperation = new Map<string, readonly string[]>()

  for (const context of contexts) {
    byOperation.set(
      context.operation.id,
      freeze(
        edges
          .filter((edge) => edge.to === context.operation.id)
          .map((edge) => edge.from)
          .sort(),
      ),
    )
  }

  return {
    edges: freeze(
      edges.sort(
        (left, right) =>
          left.from.localeCompare(right.from) ||
          left.to.localeCompare(right.to) ||
          left.reason.localeCompare(right.reason),
      ),
    ),
    byOperation,
  }
}

function postgresNativeTypes(value: SnapshotJsonValue): readonly string[] {
  const result = new Set<string>()

  const visit = (current: SnapshotJsonValue): void => {
    if (Array.isArray(current)) {
      for (const item of current) visit(item)
      return
    }

    if (!isJsonRecord(current)) return

    if (
      current.kind === "native" &&
      current.dialect === "postgresql" &&
      typeof current.type === "string"
    ) {
      result.add(current.type)
    }

    for (const child of Object.values(current)) visit(child)
  }

  visit(value)
  return [...result].sort()
}

function postgresTypeMatches(
  type: string,
  physicalName: string | undefined,
  namespace: string | undefined,
): boolean {
  if (physicalName === undefined) return false

  const normalized = type
    .trim()
    .replace(/\[\]$/u, "")
    .split(".")
    .map((part) => part.trim().replace(/^"|"$/gu, "").replaceAll('""', '"'))
  const name = normalized.at(-1)

  return (
    name === physicalName &&
    (normalized.length === 1 || namespace === undefined || normalized.at(-2) === namespace)
  )
}

function topologicalOrder(
  contexts: readonly PlannedContext[],
  dependencyResult: {
    readonly edges: readonly MigrationDependency[]
    readonly byOperation: ReadonlyMap<string, readonly string[]>
  },
  diagnostics: MigrationDiagnostic[],
): readonly PlannedContext[] {
  const byId = new Map(contexts.map((context) => [context.operation.id, context]))
  const pending = new Map<string, Set<string>>()

  for (const context of contexts) {
    pending.set(
      context.operation.id,
      new Set(dependencyResult.byOperation.get(context.operation.id) ?? []),
    )
  }

  const ready = [...contexts]
    .filter((context) => (pending.get(context.operation.id)?.size ?? 0) === 0)
    .sort((left, right) => left.operation.id.localeCompare(right.operation.id))
  const result: PlannedContext[] = []

  while (ready.length > 0) {
    const context = ready.shift()!

    result.push(context)
    for (const edge of dependencyResult.edges) {
      if (edge.from !== context.operation.id) {
        continue
      }

      const waiting = pending.get(edge.to)

      if (waiting === undefined) {
        continue
      }

      waiting.delete(edge.from)
      if (waiting.size === 0) {
        const next = byId.get(edge.to)

        if (next !== undefined) {
          ready.push(next)
          ready.sort((left, right) => left.operation.id.localeCompare(right.operation.id))
        }
      }
    }
  }

  if (result.length !== contexts.length) {
    diagnostics.push(
      planDiagnostic("dependency-cycle", "Migration operation dependencies contain a cycle", []),
    )
    return [...contexts].sort((left, right) => left.operation.id.localeCompare(right.operation.id))
  }

  return result
}

function referencedObjects(value: Readonly<Record<string, SnapshotJsonValue>>): readonly {
  readonly kind: SnapshotDiffObjectKind
  readonly id: string
}[] {
  const result: {
    kind: SnapshotDiffObjectKind
    id: string
  }[] = []
  const visit = (current: SnapshotJsonValue, key: string | undefined): void => {
    if (Array.isArray(current)) {
      for (const child of current) {
        visit(child, key)
      }

      return
    }

    if (current === null || typeof current !== "object") {
      return
    }

    if (
      key !== undefined &&
      (key === "target" ||
        key === "table" ||
        key === "parent" ||
        key === "object" ||
        key === "backingConstraint" ||
        key === "dependencies") &&
      isJsonRecord(current) &&
      isObjectKind(current.kind) &&
      typeof current.id === "string"
    ) {
      result.push({
        kind: current.kind,
        id: current.id,
      })
    }

    for (const [childKey, child] of Object.entries(current)) {
      visit(child, childKey)
    }
  }

  visit(value, undefined)
  return result
}

function sourcePath(source: SnapshotDiffOperation): SnapshotDiffPath {
  return source.path
}

function sourceContext(source: SnapshotDiffOperation): {
  readonly kind: SnapshotDiffObjectKind
  readonly namespace?: string
  readonly logicalId?: string
  readonly physicalName?: string
  readonly dialect?: SnapshotDialect
  readonly evidence?: readonly SnapshotDiffEvidence[]
} {
  return {
    kind: source.objectKind,
    ...(source.namespace === undefined ? {} : { namespace: source.namespace }),
    ...(source.logicalId === undefined ? {} : { logicalId: source.logicalId }),
    ...(source.physicalName === undefined ? {} : { physicalName: source.physicalName }),
    dialect: source.dialect,
    evidence: source.evidence,
  }
}

function operationId(source: SnapshotDiffOperation): string {
  const identity: Record<string, unknown> = {
    type: source.type,
    kind: source.objectKind,
    path: source.path,
  }

  if (source.namespace !== undefined) {
    identity.namespace = source.namespace
  }

  if (source.logicalId !== undefined) {
    identity.logicalId = source.logicalId
  }

  if (source.physicalName !== undefined) {
    identity.physicalName = source.physicalName
  }

  return `op_${fingerprintText(canonicalJson(toSnapshotJsonValue(identity))).slice("fnv1a64:".length)}`
}

function customOperationId(input: MigrationCustomSqlInput, index: number): string {
  const identity: Record<string, unknown> = {
    index,
    sql: input.sql,
    dialect: input.dialect,
    safety: input.safety,
    reason: input.reason,
  }

  if (input.reversible !== undefined) {
    identity.reversible = input.reversible
  }

  if (input.operationId !== undefined) {
    identity.operationId = input.operationId
  }

  if (input.kind !== undefined) {
    identity.kind = input.kind
  }

  if (input.namespace !== undefined) {
    identity.namespace = input.namespace
  }

  if (input.path !== undefined) {
    identity.path = input.path
  }

  if (input.position !== undefined) {
    identity.position = input.position
  }

  if (input.dependsOn !== undefined) {
    identity.dependsOn = input.dependsOn
  }

  return `custom_${fingerprintText(canonicalJson(toSnapshotJsonValue(identity))).slice(
    "fnv1a64:".length,
  )}`
}

function targetKeyFromSource(source: SnapshotDiffOperation): string {
  const object = source.after ?? source.before

  return object === undefined
    ? `${source.objectKind}\u0000${source.namespace ?? ""}\u0000${source.logicalId ?? ""}`
    : targetKeyFromObject(object)
}

function targetKeyFromObject(object: SnapshotDiffObject): string {
  return targetKeyFromReference(
    {
      kind: object.kind,
      id: object.id,
    },
    object.namespace,
  )
}

function targetKeyFromReference(
  reference: {
    readonly kind: SnapshotDiffObjectKind
    readonly id: string
  },
  namespace: string | undefined,
): string {
  return `${reference.kind}\u0000${namespace ?? ""}\u0000${reference.id}`
}

function updateOperation(
  operation: MigrationOperation,
  updates: Partial<MigrationOperation>,
): MigrationOperation {
  return {
    ...operation,
    ...updates,
  }
}

function highestSafety(operations: readonly MigrationOperation[]): MigrationSafety {
  let result: MigrationSafety = "safe"

  for (const operation of operations) {
    if (safetyRank[operation.safety] > safetyRank[result]) {
      result = operation.safety
    }
  }

  return result
}

function optionAllows(safety: MigrationSafety, options: MigrationPlanOptions): boolean {
  if (safety === "unknown") {
    return options.allowUnknown === true || options.allowLossy === true
  }

  if (safety === "unsupported") {
    return options.allowUnsupported === true
  }

  if (safety === "destructive") {
    return options.allowDestructive === true
  }

  if (safety === "review-required") {
    return options.allowReviewRequired === true
  }

  return true
}

function normalizeDecisions(
  values: readonly MigrationDecision[] | undefined,
  diagnostics: MigrationDiagnostic[],
): readonly MigrationDecision[] {
  if (values === undefined) {
    return []
  }

  const result: MigrationDecision[] = []

  for (const [index, value] of values.entries()) {
    if (
      !isRecord(value) ||
      (value.action !== "allow" && value.action !== "skip") ||
      typeof value.reason !== "string" ||
      value.reason.length === 0
    ) {
      diagnostics.push(
        planDiagnostic("invalid-plan", "Migration decisions need action and a non-empty reason", [
          "decisions",
          index,
        ]),
      )
      continue
    }

    result.push({
      action: value.action,
      reason: value.reason,
      ...(typeof value.operationId === "string" ? { operationId: value.operationId } : {}),
      ...(isObjectKind(value.kind) ? { kind: value.kind } : {}),
      ...(typeof value.namespace === "string" ? { namespace: value.namespace } : {}),
      ...(isPath(value.path) ? { path: freeze([...value.path]) } : {}),
      ...(isDiagnosticCode(value.code) ? { code: value.code } : {}),
    })
  }

  return sortDecisions(result)
}

function sortDecisions(values: readonly MigrationDecision[]): readonly MigrationDecision[] {
  return freeze(
    [...values].sort(
      (left, right) =>
        (left.operationId ?? "").localeCompare(right.operationId ?? "") ||
        (left.kind ?? "").localeCompare(right.kind ?? "") ||
        JSON.stringify(left.path ?? []).localeCompare(JSON.stringify(right.path ?? [])) ||
        left.action.localeCompare(right.action) ||
        left.reason.localeCompare(right.reason),
    ),
  )
}

function mapDiffDiagnostic(source: SnapshotDiffDiagnostic): MigrationDiagnostic {
  const code = mapDiffCode(source.code)

  return planDiagnostic(code, source.message, source.path, {
    kind: source.objectKind ?? source.kind,
    namespace: source.namespace,
    logicalId: source.logicalId,
    physicalName: source.physicalName,
    dialect: source.dialect,
    evidence: source.evidence,
    source,
    severity: source.severity,
  })
}

function mapDiffCode(code: SnapshotDiffDiagnostic["code"]): MigrationDiagnosticCode {
  if (code === "unknown") {
    return "unknown"
  }

  if (code === "lossy") {
    return "lossy"
  }

  if (code === "unsupported") {
    return "unsupported"
  }

  if (code === "destructive") {
    return "destructive"
  }

  if (code === "ambiguous") {
    return "ambiguous"
  }

  if (code === "dialect-mismatch") {
    return "dialect-mismatch"
  }

  return "invalid-plan"
}

function pathRelated(left: SnapshotDiffPath, right: SnapshotDiffPath): boolean {
  return pathStarts(left, right) || pathStarts(right, left)
}

function pathStarts(path: SnapshotDiffPath, prefix: SnapshotDiffPath): boolean {
  return prefix.length <= path.length && prefix.every((item, index) => item === path[index])
}

function planDiagnostic(
  code: MigrationDiagnosticCode,
  message: string,
  path: SnapshotDiffPath,
  options: {
    readonly severity?: "error" | "warning"
    readonly operationId?: string
    readonly kind?: SnapshotDiffObjectKind | "custom-sql"
    readonly namespace?: string
    readonly logicalId?: string
    readonly physicalName?: string
    readonly dialect?: SnapshotDialect
    readonly evidence?: readonly SnapshotDiffEvidence[]
    readonly source?: SnapshotDiffDiagnostic
  } = {},
): MigrationDiagnostic {
  return {
    code,
    severity:
      options.severity ??
      (code === "decision-required" ||
      code === "dependency-cycle" ||
      code === "invalid-plan" ||
      code === "custom-sql" ||
      code === "dialect-mismatch" ||
      code === "non-canonical"
        ? "error"
        : "warning"),
    message,
    path: freeze([...path]),
    ...(options.operationId === undefined ? {} : { operationId: options.operationId }),
    ...(options.kind === undefined ? {} : { kind: options.kind }),
    ...(options.namespace === undefined ? {} : { namespace: options.namespace }),
    ...(options.logicalId === undefined ? {} : { logicalId: options.logicalId }),
    ...(options.physicalName === undefined ? {} : { physicalName: options.physicalName }),
    ...(options.dialect === undefined ? {} : { dialect: options.dialect }),
    ...(options.evidence === undefined ? {} : { evidence: options.evidence }),
    ...(options.source === undefined ? {} : { source: options.source }),
  }
}

function sortDiagnostics(values: readonly MigrationDiagnostic[]): readonly MigrationDiagnostic[] {
  return freeze(
    [...values].sort(
      (left, right) =>
        left.code.localeCompare(right.code) ||
        JSON.stringify(left.path).localeCompare(JSON.stringify(right.path)) ||
        left.message.localeCompare(right.message),
    ),
  )
}

function validatePlanValue(input: unknown):
  | {
      readonly ok: true
      readonly value: MigrationPlan
    }
  | {
      readonly ok: false
      readonly diagnostics: readonly MigrationDiagnostic[]
    } {
  let value: unknown = input

  if (!isRecord(value)) {
    return {
      ok: false,
      diagnostics: freeze([planDiagnostic("invalid-plan", "Migration plan must be an object", [])]),
    }
  }

  try {
    value = toSnapshotJsonValue(value)
  } catch (error) {
    return {
      ok: false,
      diagnostics: freeze([
        planDiagnostic("invalid-plan", error instanceof Error ? error.message : String(error), []),
      ]),
    }
  }

  const diagnostics: MigrationDiagnostic[] = []
  const plan = value as unknown as MigrationPlan

  requireKeys(
    plan as unknown as Record<string, unknown>,
    [
      "format",
      "version",
      "dialect",
      "safety",
      "ready",
      "operations",
      "dependencies",
      "decisions",
      "diagnostics",
    ],
    [],
    diagnostics,
    ["beforeFingerprint", "afterFingerprint"],
  )
  if (plan.format !== migrationPlanFormat) {
    diagnostics.push(
      planDiagnostic("invalid-plan", `Migration plan format must be "${migrationPlanFormat}"`, [
        "format",
      ]),
    )
  }

  if (plan.version !== migrationPlanVersion) {
    diagnostics.push(
      planDiagnostic(
        "invalid-plan",
        `Unsupported migration plan version: ${String(plan.version)}`,
        ["version"],
      ),
    )
  }

  validateDialect(plan.dialect, ["dialect"], diagnostics)
  if (!isSafety(plan.safety)) {
    diagnostics.push(planDiagnostic("invalid-plan", "Plan safety is invalid", ["safety"]))
  }

  if (typeof plan.ready !== "boolean") {
    diagnostics.push(planDiagnostic("invalid-plan", "Plan ready must be boolean", ["ready"]))
  }

  if (!Array.isArray(plan.operations)) {
    diagnostics.push(
      planDiagnostic("invalid-plan", "Plan operations must be an array", ["operations"]),
    )
  }

  if (!Array.isArray(plan.dependencies)) {
    diagnostics.push(
      planDiagnostic("invalid-plan", "Plan dependencies must be an array", ["dependencies"]),
    )
  }

  if (!Array.isArray(plan.decisions)) {
    diagnostics.push(
      planDiagnostic("invalid-plan", "Plan decisions must be an array", ["decisions"]),
    )
  }

  if (!Array.isArray(plan.diagnostics)) {
    diagnostics.push(
      planDiagnostic("invalid-plan", "Plan diagnostics must be an array", ["diagnostics"]),
    )
  }

  if (typeof plan.beforeFingerprint === "string" || plan.beforeFingerprint === undefined) {
    // Optional fingerprint has no further shape requirements.
  } else {
    diagnostics.push(
      planDiagnostic("invalid-plan", "beforeFingerprint must be a string", ["beforeFingerprint"]),
    )
  }

  if (typeof plan.afterFingerprint === "string" || plan.afterFingerprint === undefined) {
    // Optional fingerprint has no further shape requirements.
  } else {
    diagnostics.push(
      planDiagnostic("invalid-plan", "afterFingerprint must be a string", ["afterFingerprint"]),
    )
  }

  if (Array.isArray(plan.operations)) {
    validateOperations(plan.operations, diagnostics)
  }

  if (Array.isArray(plan.dependencies)) {
    validateDependencies(plan, diagnostics)
  }

  if (Array.isArray(plan.decisions)) {
    validateDecisions(plan.decisions, diagnostics)
  }

  if (Array.isArray(plan.diagnostics)) {
    validateDiagnostics(plan.diagnostics, diagnostics)
  }

  if (
    Array.isArray(plan.operations) &&
    Array.isArray(plan.diagnostics) &&
    plan.operations.every((operation) => isRecord(operation))
  ) {
    const expectedReady =
      plan.diagnostics.every((diagnostic) => diagnostic.severity !== "error") &&
      plan.operations.every((operation) => operation.status !== "decision-required")

    if (typeof plan.ready === "boolean" && plan.ready !== expectedReady) {
      diagnostics.push(
        planDiagnostic(
          "non-canonical",
          "Plan ready must match its diagnostics and operation statuses",
          ["ready"],
        ),
      )
    }

    if (isSafety(plan.safety)) {
      const expectedSafety = highestSafety(
        plan.operations as unknown as readonly MigrationOperation[],
      )

      if (plan.safety !== expectedSafety) {
        diagnostics.push(
          planDiagnostic("non-canonical", "Plan safety must match its highest operation safety", [
            "safety",
          ]),
        )
      }
    }
  }

  if (diagnostics.length > 0) {
    return {
      ok: false,
      diagnostics: freeze(sortDiagnostics(diagnostics)),
    }
  }

  return {
    ok: true,
    value: freezePlan(plan),
  }
}

function validateOperations(
  operations: readonly MigrationOperation[],
  diagnostics: MigrationDiagnostic[],
): void {
  const ids = new Set<string>()

  for (const [index, operation] of operations.entries()) {
    const path: SnapshotDiffPath = ["operations", index]

    if (!isRecord(operation)) {
      diagnostics.push(planDiagnostic("invalid-plan", "Operation must be an object", path))
      continue
    }

    const candidate = operation as unknown as MigrationOperation

    requireKeys(
      operation as unknown as Record<string, unknown>,
      [
        "id",
        "type",
        "kind",
        "objectKind",
        "path",
        "dialect",
        "safety",
        "lock",
        "transaction",
        "reversible",
        "reversibility",
        "preconditions",
        "dependsOn",
        "evidence",
        "status",
        "position",
      ],
      path,
      diagnostics,
      [
        "namespace",
        "logicalId",
        "physicalName",
        "physicalReference",
        "provenance",
        "irreversibleReason",
        "origin",
        "customSql",
        "decision",
      ],
    )
    if (typeof candidate.id !== "string" || candidate.id.length === 0) {
      diagnostics.push(
        planDiagnostic("invalid-plan", "Operation ID must be non-empty", [...path, "id"]),
      )
    } else if (ids.has(candidate.id)) {
      diagnostics.push(
        planDiagnostic("invalid-plan", `Duplicate operation ID "${candidate.id}"`, [...path, "id"]),
      )
    } else {
      ids.add(candidate.id)
    }

    if (!operationValues.has(candidate.type)) {
      diagnostics.push(
        planDiagnostic("invalid-plan", "Operation type is invalid", [...path, "type"]),
      )
    }

    if (!isObjectKind(candidate.kind) && candidate.kind !== "custom-sql") {
      diagnostics.push(
        planDiagnostic("invalid-plan", "Operation kind is invalid", [...path, "kind"]),
      )
    }

    if (candidate.objectKind !== candidate.kind) {
      diagnostics.push(
        planDiagnostic("invalid-plan", "Operation objectKind must match kind", [
          ...path,
          "objectKind",
        ]),
      )
    }

    if (candidate.type === "custom-sql" && candidate.customSql === undefined) {
      diagnostics.push(
        planDiagnostic("custom-sql", "Custom SQL operation is missing its explicit SQL record", [
          ...path,
          "customSql",
        ]),
      )
    }

    if (candidate.type === "custom-sql" && candidate.customSql !== undefined) {
      validateCustomSql(candidate.customSql, [...path, "customSql"], diagnostics)
    }

    if (candidate.type !== "custom-sql" && candidate.customSql !== undefined) {
      diagnostics.push(
        planDiagnostic("invalid-plan", "Only custom-sql operations may contain customSql", [
          ...path,
          "customSql",
        ]),
      )
    }

    if (!isSafety(candidate.safety)) {
      diagnostics.push(
        planDiagnostic("invalid-plan", "Operation safety is invalid", [...path, "safety"]),
      )
    }

    if (!lockValues.has(candidate.lock)) {
      diagnostics.push(
        planDiagnostic("invalid-plan", "Operation lock requirement is invalid", [...path, "lock"]),
      )
    }

    if (!transactionValues.has(candidate.transaction)) {
      diagnostics.push(
        planDiagnostic("invalid-plan", "Operation transaction requirement is invalid", [
          ...path,
          "transaction",
        ]),
      )
    }

    if (!isPath(candidate.path)) {
      diagnostics.push(
        planDiagnostic("invalid-plan", "Operation path must be an array", [...path, "path"]),
      )
    }

    if (!isDialect(candidate.dialect)) {
      diagnostics.push(
        planDiagnostic("invalid-plan", "Operation dialect is invalid", [...path, "dialect"]),
      )
    }

    if (typeof candidate.reversible !== "boolean") {
      diagnostics.push(
        planDiagnostic("invalid-plan", "Operation reversible must be boolean", [
          ...path,
          "reversible",
        ]),
      )
    }

    if (
      typeof candidate.reversible === "boolean" &&
      candidate.reversible !== (candidate.reversibility === "reversible")
    ) {
      diagnostics.push(
        planDiagnostic("invalid-plan", "Operation reversibility does not match reversible", [
          ...path,
          "reversibility",
        ]),
      )
    }

    if (!reversibilityValues.has(candidate.reversibility)) {
      diagnostics.push(
        planDiagnostic("invalid-plan", "Operation reversibility is invalid", [
          ...path,
          "reversibility",
        ]),
      )
    }

    if (!Array.isArray(candidate.preconditions)) {
      diagnostics.push(
        planDiagnostic("invalid-plan", "Operation preconditions must be an array", [
          ...path,
          "preconditions",
        ]),
      )
    } else {
      validatePreconditions(candidate.preconditions, [...path, "preconditions"], diagnostics)
    }

    if (!Array.isArray(candidate.dependsOn)) {
      diagnostics.push(
        planDiagnostic("invalid-plan", "Operation dependsOn must be an array", [
          ...path,
          "dependsOn",
        ]),
      )
    } else {
      if (!candidate.dependsOn.every((dependency) => typeof dependency === "string")) {
        diagnostics.push(
          planDiagnostic("invalid-plan", "Operation dependsOn must contain operation IDs", [
            ...path,
            "dependsOn",
          ]),
        )
      }

      if (!isSorted(candidate.dependsOn)) {
        diagnostics.push(
          planDiagnostic("non-canonical", "Operation dependsOn must be sorted", [
            ...path,
            "dependsOn",
          ]),
        )
      }
    }

    if (!Array.isArray(candidate.evidence)) {
      diagnostics.push(
        planDiagnostic("invalid-plan", "Operation evidence must be an array", [
          ...path,
          "evidence",
        ]),
      )
    }

    if (
      candidate.status !== "approved" &&
      candidate.status !== "decision-required" &&
      candidate.status !== "skipped"
    ) {
      diagnostics.push(
        planDiagnostic("invalid-plan", "Operation status is invalid", [...path, "status"]),
      )
    }

    if (!Number.isSafeInteger(candidate.position) || candidate.position < 0) {
      diagnostics.push(
        planDiagnostic("invalid-plan", "Operation position must be a non-negative integer", [
          ...path,
          "position",
        ]),
      )
    }

    if (candidate.position !== index) {
      diagnostics.push(
        planDiagnostic("non-canonical", "Operations must use contiguous topological positions", [
          ...path,
          "position",
        ]),
      )
    }

    if (candidate.origin !== undefined) {
      validateOrigin(candidate.origin, [...path, "origin"], diagnostics)
    }

    if (candidate.decision !== undefined) {
      validateDecision(candidate.decision, [...path, "decision"], diagnostics)
    }

    if (candidate.reversible === false && typeof candidate.irreversibleReason !== "string") {
      diagnostics.push(
        planDiagnostic("invalid-plan", "Irreversible operations need a reason", [
          ...path,
          "irreversibleReason",
        ]),
      )
    }
  }
}

function validateDependencies(plan: MigrationPlan, diagnostics: MigrationDiagnostic[]): void {
  const validOperations = plan.operations.filter(
    isRecord,
  ) as unknown as readonly MigrationOperation[]
  const ids = new Set(validOperations.map((operation) => operation.id))
  const positions = new Map(validOperations.map((operation, index) => [operation.id, index]))
  const seen = new Set<string>()

  for (const [index, dependency] of plan.dependencies.entries()) {
    const path: SnapshotDiffPath = ["dependencies", index]

    if (!isRecord(dependency)) {
      diagnostics.push(planDiagnostic("invalid-plan", "Dependency must be an object", path))
      continue
    }

    const candidate = dependency as unknown as MigrationDependency

    requireKeys(
      dependency as unknown as Record<string, unknown>,
      ["from", "to", "reason"],
      path,
      diagnostics,
    )
    if (typeof candidate.from !== "string" || typeof candidate.to !== "string") {
      diagnostics.push(
        planDiagnostic("invalid-plan", "Dependency endpoints must be operation IDs", path),
      )
    }

    if (!dependencyReasons.has(candidate.reason)) {
      diagnostics.push(
        planDiagnostic("invalid-plan", "Dependency reason is invalid", [...path, "reason"]),
      )
    }

    if (!ids.has(candidate.from) || !ids.has(candidate.to)) {
      diagnostics.push(
        planDiagnostic("invalid-plan", "Dependency references an unknown operation", path),
      )
    }

    const fromPosition = positions.get(candidate.from)
    const toPosition = positions.get(candidate.to)

    if (fromPosition !== undefined && toPosition !== undefined && fromPosition >= toPosition) {
      diagnostics.push(
        planDiagnostic(
          "dependency-cycle",
          "Dependency source must appear before dependent operation",
          path,
        ),
      )
    }

    const key = `${candidate.from}\u0000${candidate.to}\u0000${candidate.reason}`

    if (seen.has(key)) {
      diagnostics.push(planDiagnostic("invalid-plan", "Duplicate dependency edge", path))
    }

    seen.add(key)
    if (index > 0) {
      const previous = plan.dependencies[index - 1]!

      if (
        isRecord(previous) &&
        compareDependency(previous as unknown as MigrationDependency, candidate) > 0
      ) {
        diagnostics.push(planDiagnostic("non-canonical", "Dependencies must be sorted", path))
      }
    }
  }

  for (const [index, operation] of plan.operations.entries()) {
    if (!isRecord(operation) || !Array.isArray(operation.dependsOn)) {
      continue
    }

    for (const dependency of operation.dependsOn) {
      if (!plan.dependencies.some((edge) => edge.from === dependency && edge.to === operation.id)) {
        diagnostics.push(
          planDiagnostic("invalid-plan", "Operation dependsOn is missing its dependency edge", [
            "operations",
            index,
            "dependsOn",
          ]),
        )
      }

      if (!ids.has(dependency)) {
        diagnostics.push(
          planDiagnostic("invalid-plan", "Operation dependsOn references an unknown operation", [
            "operations",
            index,
            "dependsOn",
          ]),
        )
      }
    }
  }
}

function validatePreconditions(
  preconditions: readonly MigrationPrecondition[],
  path: SnapshotDiffPath,
  diagnostics: MigrationDiagnostic[],
): void {
  for (const [index, precondition] of preconditions.entries()) {
    const itemPath = [...path, index]

    if (!isRecord(precondition)) {
      diagnostics.push(planDiagnostic("invalid-plan", "Precondition must be an object", itemPath))
      continue
    }

    requireKeys(
      precondition as unknown as Record<string, unknown>,
      ["type", "path", "kind"],
      itemPath,
      diagnostics,
      ["namespace", "logicalId", "physicalName", "fingerprint", "property", "value"],
    )
    if (
      precondition.type !== "snapshot-fingerprint" &&
      precondition.type !== "object-present" &&
      precondition.type !== "object-absent" &&
      precondition.type !== "property-equals"
    ) {
      diagnostics.push(
        planDiagnostic("invalid-plan", "Precondition type is invalid", [...itemPath, "type"]),
      )
    }

    if (!isPath(precondition.path)) {
      diagnostics.push(
        planDiagnostic("invalid-plan", "Precondition path must be an array", [...itemPath, "path"]),
      )
    }

    if (!isObjectKind(precondition.kind) && precondition.kind !== "custom-sql") {
      diagnostics.push(
        planDiagnostic("invalid-plan", "Precondition kind is invalid", [...itemPath, "kind"]),
      )
    }

    if (precondition.property !== undefined && !isPath(precondition.property)) {
      diagnostics.push(
        planDiagnostic("invalid-plan", "Precondition property must be an array", [
          ...itemPath,
          "property",
        ]),
      )
    }

    if (precondition.fingerprint !== undefined && typeof precondition.fingerprint !== "string") {
      diagnostics.push(
        planDiagnostic("invalid-plan", "Precondition fingerprint must be a string", [
          ...itemPath,
          "fingerprint",
        ]),
      )
    }
  }
}

function validateCustomSql(
  value: unknown,
  path: SnapshotDiffPath,
  diagnostics: MigrationDiagnostic[],
): void {
  if (!isRecord(value)) {
    diagnostics.push(planDiagnostic("custom-sql", "Custom SQL record must be an object", path))
    return
  }

  requireKeys(
    value,
    ["sql", "dialect", "safety", "position", "reason", "reversible"],
    path,
    diagnostics,
  )
  if (typeof value.sql !== "string" || value.sql.length === 0) {
    diagnostics.push(
      planDiagnostic("custom-sql", "Custom SQL must be a non-empty string", [...path, "sql"]),
    )
  }

  if (!isDialect(value.dialect)) {
    diagnostics.push(
      planDiagnostic("custom-sql", "Custom SQL dialect is invalid", [...path, "dialect"]),
    )
  }

  if (!isSafety(value.safety)) {
    diagnostics.push(
      planDiagnostic("custom-sql", "Custom SQL safety is invalid", [...path, "safety"]),
    )
  }

  if (!validPosition(value.position)) {
    diagnostics.push(
      planDiagnostic("custom-sql", "Custom SQL position must be a non-negative integer", [
        ...path,
        "position",
      ]),
    )
  }

  if (typeof value.reason !== "string" || value.reason.length === 0) {
    diagnostics.push(
      planDiagnostic("custom-sql", "Custom SQL reason must be non-empty", [...path, "reason"]),
    )
  }

  if (typeof value.reversible !== "boolean") {
    diagnostics.push(
      planDiagnostic("custom-sql", "Custom SQL reversible must be boolean", [
        ...path,
        "reversible",
      ]),
    )
  }
}

function validateOrigin(
  value: unknown,
  path: SnapshotDiffPath,
  diagnostics: MigrationDiagnostic[],
): void {
  if (!isRecord(value)) {
    diagnostics.push(planDiagnostic("invalid-plan", "Operation origin must be an object", path))
    return
  }

  requireKeys(value, ["type", "kind", "path", "evidence"], path, diagnostics, [
    "namespace",
    "logicalId",
    "physicalName",
    "physicalReference",
    "provenance",
    "before",
    "after",
  ])
  if (!operationValues.has(value.type as MigrationOperationType) || value.type === "custom-sql") {
    diagnostics.push(
      planDiagnostic("invalid-plan", "Operation origin type is invalid", [...path, "type"]),
    )
  }

  if (!isObjectKind(value.kind)) {
    diagnostics.push(
      planDiagnostic("invalid-plan", "Operation origin kind is invalid", [...path, "kind"]),
    )
  }

  if (!isPath(value.path)) {
    diagnostics.push(
      planDiagnostic("invalid-plan", "Operation origin path must be an array", [...path, "path"]),
    )
  }

  if (!Array.isArray(value.evidence)) {
    diagnostics.push(
      planDiagnostic("invalid-plan", "Operation origin evidence must be an array", [
        ...path,
        "evidence",
      ]),
    )
  }
}

function validateDecision(
  value: unknown,
  path: SnapshotDiffPath,
  diagnostics: MigrationDiagnostic[],
): void {
  if (!isRecord(value)) {
    diagnostics.push(planDiagnostic("invalid-plan", "Decision must be an object", path))
    return
  }

  requireKeys(value, ["action", "reason"], path, diagnostics, [
    "operationId",
    "kind",
    "namespace",
    "path",
    "code",
  ])
  if (value.action !== "allow" && value.action !== "skip") {
    diagnostics.push(
      planDiagnostic("invalid-plan", "Decision action is invalid", [...path, "action"]),
    )
  }

  if (typeof value.reason !== "string" || value.reason.length === 0) {
    diagnostics.push(
      planDiagnostic("invalid-plan", "Decision reason must be non-empty", [...path, "reason"]),
    )
  }

  if (value.kind !== undefined && !isObjectKind(value.kind)) {
    diagnostics.push(planDiagnostic("invalid-plan", "Decision kind is invalid", [...path, "kind"]))
  }

  if (value.path !== undefined && !isPath(value.path)) {
    diagnostics.push(
      planDiagnostic("invalid-plan", "Decision path must be an array", [...path, "path"]),
    )
  }

  if (value.code !== undefined && !isDiagnosticCode(value.code)) {
    diagnostics.push(planDiagnostic("invalid-plan", "Decision code is invalid", [...path, "code"]))
  }
}

function compareDependency(left: MigrationDependency, right: MigrationDependency): number {
  return (
    left.from.localeCompare(right.from) ||
    left.to.localeCompare(right.to) ||
    left.reason.localeCompare(right.reason)
  )
}

function isSorted(values: readonly string[]): boolean {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index - 1]!.localeCompare(values[index]!) > 0) {
      return false
    }
  }

  return true
}

function validateDecisions(
  decisions: readonly MigrationDecision[],
  diagnostics: MigrationDiagnostic[],
): void {
  for (const [index, decision] of decisions.entries()) {
    const path: SnapshotDiffPath = ["decisions", index]

    if (!isRecord(decision)) {
      diagnostics.push(planDiagnostic("invalid-plan", "Decision must be an object", path))
      continue
    }

    validateDecision(decision, path, diagnostics)
  }
}

function validateDiagnostics(
  diagnostics: readonly MigrationDiagnostic[],
  output: MigrationDiagnostic[],
): void {
  for (const [index, diagnostic] of diagnostics.entries()) {
    const path: SnapshotDiffPath = ["diagnostics", index]

    if (!isRecord(diagnostic)) {
      output.push(planDiagnostic("invalid-plan", "Diagnostic must be an object", path))
      continue
    }

    requireKeys(
      diagnostic as unknown as Record<string, unknown>,
      ["code", "severity", "message", "path"],
      path,
      output,
      [
        "operationId",
        "kind",
        "namespace",
        "logicalId",
        "physicalName",
        "dialect",
        "evidence",
        "source",
      ],
    )
    if (!isDiagnosticCode(diagnostic.code)) {
      output.push(planDiagnostic("invalid-plan", "Diagnostic code is invalid", [...path, "code"]))
    }

    if (diagnostic.severity !== "error" && diagnostic.severity !== "warning") {
      output.push(
        planDiagnostic("invalid-plan", "Diagnostic severity is invalid", [...path, "severity"]),
      )
    }

    if (typeof diagnostic.message !== "string") {
      output.push(
        planDiagnostic("invalid-plan", "Diagnostic message must be a string", [...path, "message"]),
      )
    }

    if (!isPath(diagnostic.path)) {
      output.push(
        planDiagnostic("invalid-plan", "Diagnostic path must be an array", [...path, "path"]),
      )
    }
  }
}

function validateDialect(
  value: unknown,
  path: SnapshotDiffPath,
  diagnostics: MigrationDiagnostic[],
): void {
  if (!isDialect(value)) {
    diagnostics.push(
      planDiagnostic("invalid-plan", "Dialect must contain a name and positive version", path),
    )
  }
}

function requireKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  path: SnapshotDiffPath,
  diagnostics: MigrationDiagnostic[],
  optional: readonly string[] = [],
): void {
  const allowed = new Set([...required, ...optional])

  for (const key of required) {
    if (!(key in value)) {
      diagnostics.push(
        planDiagnostic("invalid-plan", `Missing required field "${key}"`, [...path, key]),
      )
    }
  }

  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      diagnostics.push(
        planDiagnostic("invalid-plan", `Unknown plan field "${key}"`, [...path, key]),
      )
    }
  }
}

function isDialect(value: unknown): value is SnapshotDialect {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    value.name.length > 0 &&
    typeof value.version === "number" &&
    Number.isSafeInteger(value.version) &&
    value.version > 0
  )
}

function isSafety(value: unknown): value is MigrationSafety {
  return typeof value === "string" && safetyValues.has(value as MigrationSafety)
}

function isDiagnosticCode(value: unknown): value is MigrationDiagnosticCode {
  return (
    typeof value === "string" &&
    new Set<MigrationDiagnosticCode>([
      "decision-required",
      "dependency-cycle",
      "invalid-plan",
      "unknown",
      "lossy",
      "unsupported",
      "destructive",
      "ambiguous",
      "custom-sql",
      "dialect-mismatch",
      "non-canonical",
    ]).has(value as MigrationDiagnosticCode)
  )
}

function isObjectKind(value: unknown): value is SnapshotDiffObjectKind {
  return typeof value === "string" && objectKinds.has(value as SnapshotDiffObjectKind)
}

function isPath(value: unknown): value is SnapshotDiffPath {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string" || Number.isSafeInteger(item))
  )
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isJsonRecord(
  value: SnapshotJsonValue,
): value is { readonly [key: string]: SnapshotJsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function validPosition(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}

function samePath(left: SnapshotDiffPath, right: SnapshotDiffPath): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index])
}

function fingerprintJson(value: SnapshotJsonValue): string {
  return fingerprintText(canonicalJson(value))
}

function fingerprintText(source: string): string {
  let hash = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  const mask = 0xffffffffffffffffn

  for (let index = 0; index < source.length; index += 1) {
    const codePoint = source.codePointAt(index) ?? 0

    if (codePoint > 0xffff) {
      index += 1
    }

    for (const byte of new TextEncoder().encode(String.fromCodePoint(codePoint))) {
      hash ^= BigInt(byte)
      hash = (hash * prime) & mask
    }
  }

  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`
}

function freezePlan(plan: MigrationPlan): MigrationPlan {
  return deepFreeze(plan)
}

function freeze<T>(value: T): T {
  return deepFreeze(value)
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object") {
    return value
  }

  if (seen.has(value)) {
    return value
  }

  seen.add(value)
  if (Array.isArray(value)) {
    for (const item of value) {
      deepFreeze(item, seen)
    }
  } else {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child, seen)
    }
  }

  return Object.freeze(value)
}
