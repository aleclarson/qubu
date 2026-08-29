import {
  decodeCompleteSchemaSnapshot,
  decodeSchemaSnapshot,
  type SnapshotJsonValue,
} from "qubu/snapshot"

import { assertMigrationPlan } from "../plan/index.ts"
import {
  canonicalText,
  canonicalizationDescriptor,
  digestAlgorithmDescriptor,
  digestCanonical,
  isSha256Digest,
  type Sha256Digest,
} from "./canonical.ts"
import {
  ArtifactValidationError,
  baselineArtifactFormat,
  baselineArtifactVersion,
  executableArtifactFormat,
  executableArtifactVersion,
  migrationProgramFormat,
  migrationProgramVersion,
  type ArtifactDecodeResult,
  type ArtifactDiagnostic,
  type ExecutableMigrationArtifact,
  type MigrationArtifact,
  type MigrationProgram,
  type SnapshotDescriptor,
  type TaggedParameterValue,
  type UnsealedBaselineArtifact,
  type UnsealedExecutableMigrationArtifact,
  type VerifiedBaselineArtifact,
} from "./types.ts"

type RecordValue = Record<string, any>

const artifactIdPattern = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/
const decimalPattern = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/
const integerPattern = /^-?(?:0|[1-9][0-9]*)$/
const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

/** Seal a complete executable artifact and recompute every integrity digest from source values. */
export async function sealExecutableArtifact(
  input: UnsealedExecutableMigrationArtifact,
): Promise<ExecutableMigrationArtifact> {
  const diagnostics: ArtifactDiagnostic[] = []

  validateExecutable(input, diagnostics, false)
  if (diagnostics.length > 0) {
    throw new ArtifactValidationError(diagnostics)
  }

  const beforeSnapshot = await sealSnapshot(input.beforeSnapshot, ["beforeSnapshot"])
  const afterSnapshot = await sealSnapshot(input.afterSnapshot, ["afterSnapshot"])
  const source = {
    ...input,
    canonicalization: canonicalizationDescriptor,
    digestAlgorithm: digestAlgorithmDescriptor,
    customPrograms: input.customPrograms ?? [],
    planDigest: await digestCanonical("migration-plan", json(input.plan)),
    programDigest: await digestCanonical("migration-program", json(input.program)),
    beforeSnapshot,
    afterSnapshot,
  }
  const artifact = {
    ...source,
    artifactDigest: await digestCanonical("artifact", json(source)),
  } as ExecutableMigrationArtifact

  return deepFreeze(artifact)
}

/** Seal a non-executable baseline from a verified snapshot or its externally supplied digest. */
export async function sealBaselineArtifact(
  input: UnsealedBaselineArtifact,
): Promise<VerifiedBaselineArtifact> {
  const diagnostics: ArtifactDiagnostic[] = []

  validateBaseline(input, diagnostics, false)
  if (diagnostics.length > 0) {
    throw new ArtifactValidationError(diagnostics)
  }

  const snapshot = await sealSnapshot(input.snapshot, ["snapshot"])
  const source = {
    ...input,
    canonicalization: canonicalizationDescriptor,
    digestAlgorithm: digestAlgorithmDescriptor,
    snapshot,
  }
  const artifact = {
    ...source,
    artifactDigest: await digestCanonical("baseline", json(source)),
  } as VerifiedBaselineArtifact

  return deepFreeze(artifact)
}

export function encodeExecutableArtifact(artifact: ExecutableMigrationArtifact): string {
  const diagnostics: ArtifactDiagnostic[] = []

  validateExecutable(artifact, diagnostics, true)
  if (diagnostics.length > 0) {
    throw new ArtifactValidationError(diagnostics)
  }

  return canonicalText(json(artifact))
}

export function encodeBaselineArtifact(artifact: VerifiedBaselineArtifact): string {
  const diagnostics: ArtifactDiagnostic[] = []

  validateBaseline(artifact, diagnostics, true)
  if (diagnostics.length > 0) {
    throw new ArtifactValidationError(diagnostics)
  }

  return canonicalText(json(artifact))
}

export async function decodeExecutableArtifact(
  input: string | unknown,
): Promise<ArtifactDecodeResult<ExecutableMigrationArtifact>> {
  return decode(input, executableArtifactFormat) as Promise<
    ArtifactDecodeResult<ExecutableMigrationArtifact>
  >
}

export async function decodeBaselineArtifact(
  input: string | unknown,
): Promise<ArtifactDecodeResult<VerifiedBaselineArtifact>> {
  return decode(input, baselineArtifactFormat) as Promise<
    ArtifactDecodeResult<VerifiedBaselineArtifact>
  >
}

export async function decodeMigrationArtifact(
  input: string | unknown,
): Promise<ArtifactDecodeResult> {
  return decode(input)
}

export async function assertExecutableArtifact(
  input: unknown,
): Promise<ExecutableMigrationArtifact> {
  const result = await decodeExecutableArtifact(input)

  if (!result.ok) {
    throw new ArtifactValidationError(result.diagnostics)
  }

  return result.value
}

export async function assertBaselineArtifact(input: unknown): Promise<VerifiedBaselineArtifact> {
  const result = await decodeBaselineArtifact(input)

  if (!result.ok) {
    throw new ArtifactValidationError(result.diagnostics)
  }

  return result.value
}

async function decode(
  input: string | unknown,
  expectedFormat?: string,
): Promise<ArtifactDecodeResult> {
  let value: unknown = input

  if (typeof input === "string") {
    try {
      value = JSON.parse(input)
    } catch {
      return failed("invalid-json", [], "Artifact is not valid JSON")
    }
  }

  if (!record(value)) {
    return failed("invalid-value", [], "Artifact must be an object")
  }

  if (expectedFormat !== undefined && value.format !== expectedFormat) {
    return failed("invalid-value", ["format"], `Expected artifact format ${expectedFormat}`)
  }

  const diagnostics: ArtifactDiagnostic[] = []

  if (value.format === executableArtifactFormat) {
    validateExecutable(value, diagnostics, true)
  } else if (value.format === baselineArtifactFormat) {
    validateBaseline(value, diagnostics, true)
  } else {
    diagnostics.push(diag("unsupported-version", ["format"], "Unsupported artifact format"))
  }

  if (diagnostics.length === 0 && typeof input === "string") {
    try {
      if (input !== canonicalText(json(value))) {
        diagnostics.push(
          diag("non-canonical", [], "Artifact bytes are not canonical UTF-8/LF JSON"),
        )
      }
    } catch {
      diagnostics.push(diag("invalid-value", [], "Artifact contains a non-canonical JSON value"))
    }
  }

  if (diagnostics.length === 0) {
    await validateDigests(value as MigrationArtifact, diagnostics)
  }

  return diagnostics.length === 0
    ? {
        ok: true,
        value: deepFreeze(value as MigrationArtifact),
      }
    : {
        ok: false,
        diagnostics: Object.freeze(diagnostics),
      }
}

function validateExecutable(value: unknown, out: ArtifactDiagnostic[], sealed: boolean): void {
  if (!record(value)) {
    return void out.push(diag("invalid-value", [], "Artifact must be an object"))
  }

  keys(
    value,
    [
      "format",
      "version",
      "id",
      "sequence",
      "parentArtifactDigest",
      "canonicalization",
      "digestAlgorithm",
      "dialect",
      "constraints",
      "plan",
      "planDigest",
      "renderer",
      "program",
      "programDigest",
      "beforeSnapshot",
      "afterSnapshot",
      "approvals",
      "customPrograms",
      "provenance",
      "artifactDigest",
    ],
    out,
    [],
    [
      "constraints",
      ...(sealed
        ? []
        : [
            "canonicalization",
            "digestAlgorithm",
            "planDigest",
            "programDigest",
            "customPrograms",
            "artifactDigest",
          ]),
    ],
  )
  literal(value.format, executableArtifactFormat, out, ["format"])
  literal(value.version, executableArtifactVersion, out, ["version"], "unsupported-version")
  lineage(value, out)
  if (sealed) {
    encodingDescriptors(value, out)
  }

  dialect(value.dialect, out, ["dialect"])
  constraints(value.constraints, out, ["constraints"])
  try {
    assertMigrationPlan(value.plan)
  } catch {
    out.push(diag("invalid-value", ["plan"], "Migration plan is invalid"))
  }

  renderer(value.renderer, out)
  program(value.program, out)
  validateProgramAgainstPlan(value.program, value.plan, out)
  snapshot(value.beforeSnapshot, out, ["beforeSnapshot"], sealed)
  snapshot(value.afterSnapshot, out, ["afterSnapshot"], sealed)
  approvals(value.approvals, value.plan, out)
  customPrograms(value.customPrograms ?? [], value.approvals, out)
  provenance(value.provenance, out, ["provenance"])
  if (sealed) {
    digest(value.planDigest, out, ["planDigest"])
    digest(value.programDigest, out, ["programDigest"])
    digest(value.artifactDigest, out, ["artifactDigest"])
  }

  if (
    record(value.dialect) &&
    record(value.renderer) &&
    record(value.renderer.dialect) &&
    value.dialect.name !== value.renderer.dialect.name
  ) {
    out.push(
      diag(
        "invalid-value",
        ["renderer", "dialect"],
        "Renderer dialect must match artifact dialect",
      ),
    )
  }

  if (
    record(value.plan) &&
    Array.isArray(value.plan.operations) &&
    value.plan.operations.some(
      (operation: unknown) => record(operation) && operation.status === "skipped",
    ) &&
    (!record(value.afterSnapshot) || value.afterSnapshot.value === undefined)
  ) {
    out.push(
      diag(
        "invalid-value",
        ["afterSnapshot", "value"],
        "Skipped operations require an embedded recomputed target snapshot",
      ),
    )
  }
}

function validateBaseline(value: unknown, out: ArtifactDiagnostic[], sealed: boolean): void {
  if (!record(value)) {
    return void out.push(diag("invalid-value", [], "Baseline must be an object"))
  }

  keys(
    value,
    [
      "format",
      "version",
      "id",
      "sequence",
      "parentArtifactDigest",
      "canonicalization",
      "digestAlgorithm",
      "dialect",
      "constraints",
      "snapshot",
      "verifiedAt",
      "provenance",
      "operator",
      "artifactDigest",
    ],
    out,
    [],
    [
      "constraints",
      "operator",
      ...(sealed ? [] : ["canonicalization", "digestAlgorithm", "artifactDigest"]),
    ],
  )
  literal(value.format, baselineArtifactFormat, out, ["format"])
  literal(value.version, baselineArtifactVersion, out, ["version"], "unsupported-version")
  lineage(value, out)
  if (sealed) {
    encodingDescriptors(value, out)
  }

  dialect(value.dialect, out, ["dialect"])
  constraints(value.constraints, out, ["constraints"])
  snapshot(value.snapshot, out, ["snapshot"], sealed)
  string(value.verifiedAt, out, ["verifiedAt"])
  if (typeof value.verifiedAt === "string" && !validDate(value.verifiedAt)) {
    out.push(diag("invalid-value", ["verifiedAt"], "Expected canonical RFC 3339 timestamp"))
  }

  provenance(value.provenance, out, ["provenance"])
  if (value.operator !== undefined) {
    jsonValue(value.operator, out, ["operator"])
  }

  if (sealed) {
    digest(value.artifactDigest, out, ["artifactDigest"])
  }
}

function program(value: unknown, out: ArtifactDiagnostic[]): value is MigrationProgram {
  if (!record(value)) {
    out.push(diag("invalid-value", ["program"], "Program must be an object"))
    return false
  }

  keys(value, ["format", "version", "phases"], out, ["program"])
  literal(value.format, migrationProgramFormat, out, ["program", "format"])
  literal(
    value.version,
    migrationProgramVersion,
    out,
    ["program", "version"],
    "unsupported-version",
  )
  if (!Array.isArray(value.phases)) {
    out.push(diag("invalid-value", ["program", "phases"], "Phases must be an array"))
    return false
  }

  value.phases.forEach((phase: unknown, index: number) => {
    const path = ["program", "phases", index] as const

    if (!record(phase)) {
      return void out.push(diag("invalid-value", path, "Phase must be an object"))
    }

    keys(
      phase,
      [
        "id",
        "position",
        "transaction",
        "lock",
        "dependsOn",
        "statements",
        "preconditions",
        "postconditions",
      ],
      out,
      path,
    )
    id(phase.id, out, [...path, "id"])
    position(phase.position, index, out, [...path, "position"])
    oneOf(phase.transaction, ["required", "optional", "forbidden"], out, [...path, "transaction"])
    oneOf(phase.lock, ["none", "shared", "exclusive"], out, [...path, "lock"])
    strings(phase.dependsOn, out, [...path, "dependsOn"])
    if (!Array.isArray(phase.statements)) {
      out.push(diag("invalid-value", [...path, "statements"], "Statements must be an array"))
    } else {
      phase.statements.forEach((statement: unknown, statementIndex: number) =>
        validateStatement(statement, statementIndex, out, [...path, "statements", statementIndex]),
      )
    }

    conditions(phase.preconditions, out, [...path, "preconditions"])
    conditions(phase.postconditions, out, [...path, "postconditions"])
  })
  uniqueIds(value.phases, out, ["program", "phases"])
  return true
}

/** Validate a standalone program, optionally including its relationship to a migration plan. */
export function validateMigrationProgram(
  value: unknown,
  plan?: unknown,
): readonly ArtifactDiagnostic[] {
  const diagnostics: ArtifactDiagnostic[] = []
  program(value, diagnostics)
  if (plan !== undefined) {
    validateProgramAgainstPlan(value, plan, diagnostics)
  }
  return Object.freeze(diagnostics)
}

function validateStatement(
  value: unknown,
  index: number,
  out: ArtifactDiagnostic[],
  path: readonly (string | number)[],
): void {
  if (!record(value)) {
    return void out.push(diag("invalid-value", path, "Statement must be an object"))
  }

  keys(value, ["id", "position", "operationId", "sql", "parameters", "dependsOn"], out, path)
  id(value.id, out, [...path, "id"])
  position(value.position, index, out, [...path, "position"])
  id(value.operationId, out, [...path, "operationId"])
  string(value.sql, out, [...path, "sql"])
  strings(value.dependsOn, out, [...path, "dependsOn"])
  if (!Array.isArray(value.parameters)) {
    out.push(diag("invalid-value", [...path, "parameters"], "Parameters must be an array"))
  } else {
    value.parameters.forEach((parameter: unknown, i: number) =>
      taggedParameter(parameter, out, [...path, "parameters", i]),
    )
  }
}

function taggedParameter(
  value: unknown,
  out: ArtifactDiagnostic[],
  path: readonly (string | number)[],
): value is TaggedParameterValue {
  if (!record(value) || typeof value.type !== "string") {
    out.push(diag("invalid-value", path, "Parameter must be tagged"))
    return false
  }

  const fields: Record<string, string[]> = {
    null: ["type"],
    boolean: ["type", "value"],
    string: ["type", "value"],
    number: ["type", "value"],
    bigint: ["type", "value"],
    bytes: ["type", "base64"],
    json: ["type", "value"],
  }
  const allowed = fields[value.type]

  if (!allowed) {
    out.push(diag("invalid-value", [...path, "type"], "Unsupported parameter tag"))
    return false
  }

  keys(value, allowed, out, path)
  if (value.type === "boolean" && typeof value.value !== "boolean") {
    out.push(diag("invalid-value", [...path, "value"], "Expected boolean"))
  }

  if (value.type === "string") {
    string(value.value, out, [...path, "value"])
  }

  if (
    value.type === "number" &&
    (typeof value.value !== "string" ||
      !decimalPattern.test(value.value) ||
      !Number.isFinite(Number(value.value)) ||
      String(Number(value.value)) !== value.value)
  ) {
    out.push(diag("invalid-value", [...path, "value"], "Expected canonical finite decimal"))
  }

  if (
    value.type === "bigint" &&
    (typeof value.value !== "string" || !integerPattern.test(value.value) || value.value === "-0")
  ) {
    out.push(diag("invalid-value", [...path, "value"], "Expected canonical integer"))
  }

  if (
    value.type === "bytes" &&
    (typeof value.base64 !== "string" || !base64Pattern.test(value.base64))
  ) {
    out.push(diag("invalid-value", [...path, "base64"], "Expected canonical base64"))
  }

  if (value.type === "json") {
    jsonValue(value.value, out, [...path, "value"])
  }

  return true
}

function approvals(value: unknown, rawPlan: unknown, out: ArtifactDiagnostic[]): void {
  if (!Array.isArray(value)) {
    return void out.push(diag("invalid-value", ["approvals"], "Approvals must be an array"))
  }

  const seen = new Set<string>()

  for (let index = 0; index < value.length; index++) {
    const approval = value[index]
    const path = ["approvals", index] as const

    if (!record(approval)) {
      out.push(diag("invalid-value", path, "Approval must be an object"))
      continue
    }

    keys(
      approval,
      ["operationId", "decision", "safety", "findings", "reason", "approvedBy", "approvedAt"],
      out,
      path,
      ["approvedBy", "approvedAt"],
    )
    id(approval.operationId, out, [...path, "operationId"])
    oneOf(approval.decision, ["approve", "custom-program"], out, [...path, "decision"])
    oneOf(
      approval.safety,
      ["safe", "review-required", "destructive", "unsupported", "unknown"],
      out,
      [...path, "safety"],
    )
    strings(approval.findings, out, [...path, "findings"], true)
    nonempty(approval.reason, out, [...path, "reason"])
    if (approval.approvedBy !== undefined) {
      nonempty(approval.approvedBy, out, [...path, "approvedBy"])
    }

    if (approval.approvedAt !== undefined && !validDate(approval.approvedAt)) {
      out.push(
        diag("invalid-value", [...path, "approvedAt"], "Expected canonical RFC 3339 timestamp"),
      )
    }

    if (typeof approval.operationId === "string" && seen.has(approval.operationId)) {
      out.push(diag("duplicate", [...path, "operationId"], "Duplicate operation approval"))
    }

    seen.add(approval.operationId)
    if (
      index > 0 &&
      record(value[index - 1]) &&
      String(value[index - 1].operationId) >= String(approval.operationId)
    ) {
      out.push(diag("non-canonical", path, "Approvals must be ordered by operationId"))
    }
  }

  if (record(rawPlan) && Array.isArray(rawPlan.operations)) {
    const planDiagnostics = Array.isArray(rawPlan.diagnostics) ? rawPlan.diagnostics : []
    const operations = new Map(
      rawPlan.operations.filter(record).map((operation: RecordValue) => [operation.id, operation]),
    )

    for (const approval of value.filter(record)) {
      const operation = operations.get(approval.operationId)

      if (!operation) {
        out.push(
          diag(
            "invalid-value",
            ["approvals"],
            `Approval targets unknown operation ${approval.operationId}`,
          ),
        )
      } else if (approval.safety !== operation.safety) {
        out.push(
          diag(
            "invalid-value",
            ["approvals"],
            `Approval safety does not match operation ${approval.operationId}`,
          ),
        )
      } else {
        const expectedFindings = planDiagnostics
          .filter(
            (finding: unknown) => record(finding) && finding.operationId === approval.operationId,
          )
          .map((finding: RecordValue) => finding.code)
          .sort()

        if (
          Array.isArray(approval.findings) &&
          (approval.findings.length !== expectedFindings.length ||
            approval.findings.some(
              (finding: string, index: number) => finding !== expectedFindings[index],
            ))
        ) {
          out.push(
            diag(
              "invalid-value",
              ["approvals"],
              `Approval findings do not match operation ${approval.operationId}`,
            ),
          )
        }
      }
    }

    for (const operation of operations.values()) {
      const diagnosticRequiresApproval = planDiagnostics.some(
        (finding: unknown) =>
          record(finding) &&
          finding.operationId === operation.id &&
          ["lossy", "destructive", "unknown", "unsupported", "custom-sql"].includes(finding.code),
      )

      if (
        operation.status !== "skipped" &&
        (operation.safety !== "safe" ||
          operation.type === "custom-sql" ||
          diagnosticRequiresApproval) &&
        !seen.has(operation.id)
      ) {
        out.push(
          diag(
            "approval-required",
            ["approvals"],
            `Operation ${operation.id} requires an exact approval and reason`,
          ),
        )
      }

      const approval = value.find(
        (candidate: unknown) => record(candidate) && candidate.operationId === operation.id,
      )

      if (
        operation.status !== "skipped" &&
        (operation.safety === "unknown" ||
          operation.safety === "unsupported" ||
          operation.type === "custom-sql") &&
        (!record(approval) || approval.decision !== "custom-program")
      ) {
        out.push(
          diag(
            "approval-required",
            ["approvals"],
            `Operation ${operation.id} requires explicit custom-program substitution`,
          ),
        )
      }
    }

    if ([...operations.values()].some((operation) => operation.status === "skipped")) {
      // A sealed skipped plan must carry the actual recomputed target, never only a stale fingerprint.
      // The enclosing validation checks this stronger invariant after the snapshot descriptor is known.
    }
  }
}

function validateProgramAgainstPlan(
  rawProgram: unknown,
  rawPlan: unknown,
  out: ArtifactDiagnostic[],
): void {
  if (
    !record(rawProgram) ||
    !Array.isArray(rawProgram.phases) ||
    !record(rawPlan) ||
    !Array.isArray(rawPlan.operations)
  ) {
    return
  }

  const operationIds = new Set(
    rawPlan.operations
      .filter(record)
      .filter((operation) => operation.status !== "skipped")
      .map((operation) => operation.id),
  )
  const priorPhases = new Set<string>()
  const priorStatements = new Set<string>()
  const statementOperationIds = new Set<string>()

  rawProgram.phases.forEach((phase: unknown, phaseIndex: number) => {
    if (!record(phase)) {
      return
    }

    if (Array.isArray(phase.dependsOn)) {
      for (const dependency of phase.dependsOn) {
        if (!priorPhases.has(dependency)) {
          out.push(
            diag(
              "invalid-value",
              ["program", "phases", phaseIndex, "dependsOn"],
              `Phase dependency ${String(dependency)} must reference an earlier phase`,
            ),
          )
        }
      }
    }

    if (Array.isArray(phase.statements)) {
      phase.statements.forEach((statement: unknown, statementIndex: number) => {
        if (!record(statement)) {
          return
        }

        if (!operationIds.has(statement.operationId)) {
          out.push(
            diag(
              "invalid-value",
              ["program", "phases", phaseIndex, "statements", statementIndex, "operationId"],
              `Statement targets unknown or skipped operation ${String(statement.operationId)}`,
            ),
          )
        }

        if (typeof statement.operationId === "string") {
          statementOperationIds.add(statement.operationId)
        }

        if (Array.isArray(statement.dependsOn)) {
          for (const dependency of statement.dependsOn) {
            if (!priorStatements.has(dependency)) {
              out.push(
                diag(
                  "invalid-value",
                  ["program", "phases", phaseIndex, "statements", statementIndex, "dependsOn"],
                  `Statement dependency ${String(dependency)} must reference an earlier statement`,
                ),
              )
            }
          }
        }

        if (typeof statement.id === "string") {
          if (priorStatements.has(statement.id)) {
            out.push(
              diag(
                "duplicate",
                ["program", "phases", phaseIndex, "statements", statementIndex, "id"],
                `Duplicate statement ID ${statement.id}`,
              ),
            )
          }

          priorStatements.add(statement.id)
        }
      })
    }

    if (typeof phase.id === "string") {
      priorPhases.add(phase.id)
    }
  })

  for (const operation of rawPlan.operations.filter(record)) {
    if (
      operation.status !== "skipped" &&
      (operation.type === "custom-sql" ||
        operation.safety === "unknown" ||
        operation.safety === "unsupported") &&
      !statementOperationIds.has(operation.id)
    ) {
      out.push(
        diag(
          "invalid-value",
          ["program", "phases"],
          `Custom program for ${String(operation.id)} must contain an executable statement`,
        ),
      )
    }
  }
}

function customPrograms(value: unknown, rawApprovals: unknown, out: ArtifactDiagnostic[]): void {
  if (!Array.isArray(value)) {
    return void out.push(
      diag("invalid-value", ["customPrograms"], "Custom program provenance must be an array"),
    )
  }

  const seen = new Set<string>()

  value.forEach((item, index) => {
    const path = ["customPrograms", index] as const

    if (!record(item)) {
      return void out.push(
        diag("invalid-value", path, "Custom program provenance must be an object"),
      )
    }

    keys(item, ["operationId", "source", "reason", "revision"], out, path, ["revision"])
    id(item.operationId, out, [...path, "operationId"])
    nonempty(item.source, out, [...path, "source"])
    nonempty(item.reason, out, [...path, "reason"])
    if (item.revision !== undefined) {
      nonempty(item.revision, out, [...path, "revision"])
    }

    if (seen.has(item.operationId)) {
      out.push(diag("duplicate", [...path, "operationId"], "Duplicate custom-program provenance"))
    }

    seen.add(item.operationId)
    if (
      index > 0 &&
      record(value[index - 1]) &&
      String(value[index - 1].operationId) >= String(item.operationId)
    ) {
      out.push(
        diag("non-canonical", path, "Custom program provenance must be ordered by operationId"),
      )
    }
  })
  if (Array.isArray(rawApprovals)) {
    const customApprovalIds = new Set(
      rawApprovals
        .filter(record)
        .filter((approval) => approval.decision === "custom-program")
        .map((approval) => approval.operationId),
    )

    for (const operationId of seen) {
      if (!customApprovalIds.has(operationId)) {
        out.push(
          diag(
            "invalid-value",
            ["customPrograms"],
            `Custom-program provenance for ${operationId} requires matching approval`,
          ),
        )
      }
    }

    for (const approval of rawApprovals.filter(record)) {
      if (approval.decision === "custom-program" && !seen.has(approval.operationId)) {
        out.push(
          diag(
            "invalid-value",
            ["customPrograms"],
            `Custom program for ${approval.operationId} requires provenance`,
          ),
        )
      }
    }
  }
}

async function validateDigests(value: MigrationArtifact, out: ArtifactDiagnostic[]): Promise<void> {
  if (value.format === executableArtifactFormat) {
    await match(value.planDigest, "migration-plan", value.plan, ["planDigest"], out)
    await match(value.programDigest, "migration-program", value.program, ["programDigest"], out)
    await validateSnapshotDigest(value.beforeSnapshot, ["beforeSnapshot"], out)
    await validateSnapshotDigest(value.afterSnapshot, ["afterSnapshot"], out)
    const { artifactDigest: _digest, ...source } = value

    await match(value.artifactDigest, "artifact", source, ["artifactDigest"], out)
  } else {
    await validateSnapshotDigest(value.snapshot, ["snapshot"], out)
    const { artifactDigest: _digest, ...source } = value

    await match(value.artifactDigest, "baseline", source, ["artifactDigest"], out)
  }
}

async function validateSnapshotDigest(
  descriptor: SnapshotDescriptor,
  path: readonly string[],
  out: ArtifactDiagnostic[],
): Promise<void> {
  if (descriptor.value !== undefined) {
    await match(descriptor.digest, "schema-snapshot", descriptor.value, [...path, "digest"], out)
  }
}

async function match(
  actual: Sha256Digest,
  domain: Parameters<typeof digestCanonical>[0],
  source: unknown,
  path: readonly (string | number)[],
  out: ArtifactDiagnostic[],
): Promise<void> {
  const expected = await digestCanonical(domain, json(source))

  if (actual !== expected) {
    out.push(diag("digest-mismatch", path, `Digest mismatch; expected ${expected}`))
  }
}

async function sealSnapshot(
  value: Omit<SnapshotDescriptor, "digest"> & {
    readonly digest?: Sha256Digest
  },
  path: readonly string[],
): Promise<SnapshotDescriptor> {
  if (value.value !== undefined) {
    return {
      ...value,
      digest: await digestCanonical("schema-snapshot", json(value.value)),
    }
  }

  if (value.digest !== undefined) {
    return value as SnapshotDescriptor
  }

  throw new ArtifactValidationError([
    diag("invalid-value", [...path, "digest"], "Referenced snapshot requires a strong digest"),
  ])
}

function lineage(value: RecordValue, out: ArtifactDiagnostic[]): void {
  if (typeof value.id !== "string" || !artifactIdPattern.test(value.id)) {
    out.push(diag("invalid-value", ["id"], "Artifact ID must be a stable lowercase identifier"))
  }

  if (!Number.isSafeInteger(value.sequence) || value.sequence < 0) {
    out.push(diag("invalid-value", ["sequence"], "Sequence must be a non-negative safe integer"))
  }

  if (value.parentArtifactDigest !== null && !isSha256Digest(value.parentArtifactDigest)) {
    out.push(
      diag(
        "invalid-value",
        ["parentArtifactDigest"],
        "Parent must be null or a SHA-256 artifact digest",
      ),
    )
  }
}

function encodingDescriptors(value: RecordValue, out: ArtifactDiagnostic[]): void {
  if (!record(value.canonicalization)) {
    out.push(diag("invalid-value", ["canonicalization"], "Canonicalization descriptor is required"))
  } else {
    keys(value.canonicalization, ["format", "version"], out, ["canonicalization"])
    literal(value.canonicalization.format, "qubu-canonical-json", out, [
      "canonicalization",
      "format",
    ])
    literal(
      value.canonicalization.version,
      1,
      out,
      ["canonicalization", "version"],
      "unsupported-version",
    )
  }

  if (!record(value.digestAlgorithm)) {
    out.push(diag("invalid-value", ["digestAlgorithm"], "Digest algorithm descriptor is required"))
  } else {
    keys(value.digestAlgorithm, ["algorithm", "version"], out, ["digestAlgorithm"])
    literal(value.digestAlgorithm.algorithm, "sha-256", out, ["digestAlgorithm", "algorithm"])
    literal(
      value.digestAlgorithm.version,
      1,
      out,
      ["digestAlgorithm", "version"],
      "unsupported-version",
    )
  }
}

function renderer(value: unknown, out: ArtifactDiagnostic[]): void {
  if (!record(value)) {
    return void out.push(diag("invalid-value", ["renderer"], "Renderer must be an object"))
  }

  keys(value, ["id", "version", "dialect"], out, ["renderer"])
  id(value.id, out, ["renderer", "id"])
  if (!Number.isSafeInteger(value.version) || value.version < 1) {
    out.push(diag("invalid-value", ["renderer", "version"], "Renderer version must be positive"))
  }

  dialect(value.dialect, out, ["renderer", "dialect"])
}

function dialect(
  value: unknown,
  out: ArtifactDiagnostic[],
  path: readonly (string | number)[],
): void {
  if (!record(value)) {
    return void out.push(diag("invalid-value", path, "Dialect must be an object"))
  }

  keys(value, ["name", "version"], out, path)
  id(value.name, out, [...path, "name"])
  if (!Number.isSafeInteger(value.version) || value.version < 1) {
    out.push(diag("invalid-value", [...path, "version"], "Dialect version must be positive"))
  }
}

function constraints(
  value: unknown,
  out: ArtifactDiagnostic[],
  path: readonly (string | number)[],
): void {
  if (value === undefined) {
    return
  }

  if (!record(value)) {
    return void out.push(diag("invalid-value", path, "Constraints must be an object"))
  }

  keys(value, ["minimumServerVersion", "requiredCapabilities"], out, path, [
    "minimumServerVersion",
    "requiredCapabilities",
  ])
  if (value.minimumServerVersion !== undefined) {
    nonempty(value.minimumServerVersion, out, [...path, "minimumServerVersion"])
  }

  if (value.requiredCapabilities !== undefined) {
    strings(value.requiredCapabilities, out, [...path, "requiredCapabilities"], true)
  }
}

function snapshot(
  value: unknown,
  out: ArtifactDiagnostic[],
  path: readonly (string | number)[],
  sealed: boolean,
): void {
  if (!record(value)) {
    return void out.push(diag("invalid-value", path, "Snapshot descriptor must be an object"))
  }

  keys(value, ["digest", "value", "reference"], out, path, [
    "value",
    "reference",
    ...(sealed ? [] : ["digest"]),
  ])
  if (sealed || value.digest !== undefined) {
    digest(value.digest, out, [...path, "digest"])
  }

  if (value.value === undefined && value.reference === undefined) {
    out.push(diag("invalid-value", path, "Snapshot value or reference is required"))
  }

  if (value.value !== undefined) {
    const decoded =
      record(value.value) && value.value.version === 2
        ? decodeCompleteSchemaSnapshot(value.value)
        : decodeSchemaSnapshot(value.value)
    if (!decoded.ok) {
      out.push(diag("invalid-value", [...path, "value"], "Embedded Qubu snapshot is invalid"))
    }
  }

  if (value.reference !== undefined) {
    nonempty(value.reference, out, [...path, "reference"])
  }
}

function provenance(
  value: unknown,
  out: ArtifactDiagnostic[],
  path: readonly (string | number)[],
): void {
  if (!record(value)) {
    return void out.push(diag("invalid-value", path, "Provenance must be an object"))
  }

  keys(value, ["source", "revision", "actor", "metadata"], out, path, [
    "revision",
    "actor",
    "metadata",
  ])
  nonempty(value.source, out, [...path, "source"])
  if (value.revision !== undefined) {
    nonempty(value.revision, out, [...path, "revision"])
  }

  if (value.actor !== undefined) {
    nonempty(value.actor, out, [...path, "actor"])
  }

  if (value.metadata !== undefined) {
    jsonValue(value.metadata, out, [...path, "metadata"])
  }
}

function conditions(
  value: unknown,
  out: ArtifactDiagnostic[],
  path: readonly (string | number)[],
): void {
  if (!Array.isArray(value)) {
    return void out.push(diag("invalid-value", path, "Conditions must be an array"))
  }

  value.forEach((condition, index) => {
    const itemPath = [...path, index]

    if (!record(condition)) {
      return void out.push(diag("invalid-value", itemPath, "Condition must be an object"))
    }

    keys(condition, ["id", "type", "value"], out, itemPath)
    id(condition.id, out, [...itemPath, "id"])
    oneOf(
      condition.type,
      ["object-present", "object-absent", "snapshot-digest", "statement"],
      out,
      [...itemPath, "type"],
    )
    jsonValue(condition.value, out, [...itemPath, "value"])
  })
  uniqueIds(value, out, path)
}

function keys(
  value: RecordValue,
  allowed: readonly string[],
  out: ArtifactDiagnostic[],
  path: readonly (string | number)[],
  optional: readonly string[] = [],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      out.push(diag("unknown-key", [...path, key], `Unknown key ${key}`))
    }
  }

  for (const key of allowed) {
    if (!optional.includes(key) && !(key in value)) {
      out.push(diag("invalid-value", [...path, key], `Missing key ${key}`))
    }
  }
}

function jsonValue(
  value: unknown,
  out: ArtifactDiagnostic[],
  path: readonly (string | number)[],
): void {
  try {
    canonicalText(json(value))
  } catch {
    out.push(diag("invalid-value", path, "Expected a canonical JSON value"))
  }
}

function json(value: unknown): SnapshotJsonValue {
  return value as SnapshotJsonValue
}

function digest(
  value: unknown,
  out: ArtifactDiagnostic[],
  path: readonly (string | number)[],
): void {
  if (!isSha256Digest(value)) {
    out.push(diag("invalid-value", path, "Expected sha256: followed by 64 lowercase hex digits"))
  }
}

function string(
  value: unknown,
  out: ArtifactDiagnostic[],
  path: readonly (string | number)[],
): void {
  if (typeof value !== "string") {
    out.push(diag("invalid-value", path, "Expected string"))
  }
}

function nonempty(
  value: unknown,
  out: ArtifactDiagnostic[],
  path: readonly (string | number)[],
): void {
  if (typeof value !== "string" || value.trim() === "") {
    out.push(diag("invalid-value", path, "Expected non-empty string"))
  }
}

function id(value: unknown, out: ArtifactDiagnostic[], path: readonly (string | number)[]): void {
  if (typeof value !== "string" || !artifactIdPattern.test(value)) {
    out.push(diag("invalid-value", path, "Expected stable lowercase identifier"))
  }
}

function position(
  value: unknown,
  expected: number,
  out: ArtifactDiagnostic[],
  path: readonly (string | number)[],
): void {
  if (value !== expected) {
    out.push(diag("non-canonical", path, `Expected contiguous position ${expected}`))
  }
}

function literal(
  value: unknown,
  expected: unknown,
  out: ArtifactDiagnostic[],
  path: readonly (string | number)[],
  code: ArtifactDiagnostic["code"] = "invalid-value",
): void {
  if (value !== expected) {
    out.push(diag(code, path, `Expected ${String(expected)}`))
  }
}

function oneOf(
  value: unknown,
  choices: readonly string[],
  out: ArtifactDiagnostic[],
  path: readonly (string | number)[],
): void {
  if (typeof value !== "string" || !choices.includes(value)) {
    out.push(diag("invalid-value", path, `Expected one of ${choices.join(", ")}`))
  }
}

function strings(
  value: unknown,
  out: ArtifactDiagnostic[],
  path: readonly (string | number)[],
  sorted = false,
): void {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    return void out.push(diag("invalid-value", path, "Expected string array"))
  }

  if (new Set(value).size !== value.length) {
    out.push(diag("duplicate", path, "Values must be unique"))
  }

  if (sorted && value.some((item, index) => index > 0 && value[index - 1] >= item)) {
    out.push(diag("non-canonical", path, "Values must be sorted"))
  }
}

function uniqueIds(
  value: readonly unknown[],
  out: ArtifactDiagnostic[],
  path: readonly (string | number)[],
): void {
  const ids = value.filter(record).map((item) => item.id)

  if (new Set(ids).size !== ids.length) {
    out.push(diag("duplicate", path, "IDs must be unique"))
  }
}

function validDate(value: unknown): boolean {
  return (
    typeof value === "string" &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value) &&
    new Date(value).toISOString() === (value.includes(".") ? value : value.replace("Z", ".000Z"))
  )
}

function record(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function diag(
  code: ArtifactDiagnostic["code"],
  path: readonly (string | number)[],
  message: string,
): ArtifactDiagnostic {
  return Object.freeze({
    code,
    path: Object.freeze([...path]),
    message,
  })
}

function failed(
  code: ArtifactDiagnostic["code"],
  path: readonly (string | number)[],
  message: string,
): ArtifactDecodeResult {
  return {
    ok: false,
    diagnostics: Object.freeze([diag(code, path, message)]),
  }
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object" || seen.has(value)) {
    return value
  }

  seen.add(value)
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child, seen)
  }

  return Object.freeze(value)
}
