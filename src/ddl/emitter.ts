import {
  assertMigrationPlan,
  type MigrationOperation,
  type MigrationPlan,
} from "../migration/index.ts"
import type { SchemaDialect } from "../schema/dialect.ts"
import type { SnapshotExpression } from "../snapshot/types.ts"
import type {
  DdlDiagnostic,
  DdlEmission,
  DdlEmissionOptions,
  DdlEmitter,
  DdlStatement,
} from "./types.ts"

type JsonRecord = Record<string, unknown>

export interface DdlFeatures {
  readonly dialect: "postgresql" | "sqlite" | "mysql"
  readonly supports: ReadonlySet<string>
}

const objectKinds = new Set([
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
  "custom-sql",
])

const lockRank = {
  none: 0,
  shared: 1,
  exclusive: 2,
} as const

/**
 * Build the shared strict preflight and rendering boundary for one engine. The renderer only
 * receives a validated MigrationPlan and a SchemaDialect.
 */
export function createDdlEmitter(features: DdlFeatures): DdlEmitter {
  const emitter: DdlEmitter = {
    dialect: features.dialect,
    diagnose(plan, schemaDialect, options = {}) {
      return preflight(plan, schemaDialect, options, features)
    },
    emit(plan, schemaDialect, options = {}) {
      const diagnostics = preflight(plan, schemaDialect, options, features)

      if (diagnostics.some((item) => item.severity === "error")) {
        return emission(false, schemaDialect.name, [], diagnostics)
      }

      let validated: MigrationPlan

      try {
        validated = assertMigrationPlan(plan)
      } catch {
        return emission(false, schemaDialect.name, [], diagnostics)
      }

      const statements: DdlStatement[] = []

      try {
        for (const operation of validated.operations) {
          if (operation.status === "skipped") {
            continue
          }

          if (isCoveredByParent(operation, validated.operations)) {
            continue
          }

          const sql = renderOperation(operation, validated.operations, schemaDialect, features)

          if (sql === undefined || sql.length === 0) {
            continue
          }

          statements.push({
            operationId: operation.id,
            position: operation.position,
            kind: operation.kind,
            sql,
            text: sql,
            parameters: Object.freeze([]),
          })
        }
      } catch (error) {
        const diagnostic: DdlDiagnostic = {
          code: "malformed-operation",
          severity: "error",
          message: error instanceof Error ? error.message : String(error),
          path: [],
        }

        return emission(false, schemaDialect.name, [], [...diagnostics, diagnostic])
      }

      return emission(true, schemaDialect.name, statements, diagnostics)
    },
  }

  return Object.freeze(emitter)
}

function preflight(
  input: MigrationPlan,
  schemaDialect: SchemaDialect,
  options: DdlEmissionOptions,
  features: DdlFeatures,
): readonly DdlDiagnostic[] {
  const diagnostics: DdlDiagnostic[] = []
  let plan: MigrationPlan

  try {
    plan = assertMigrationPlan(input)
  } catch (error) {
    const raw = isRecord(input) ? input : undefined

    if (raw?.ready === false && !options.allowBlocked && !options.allowUnsafe) {
      diagnostics.push({
        code: "blocked-plan",
        severity: "error",
        message: "Migration plan is blocked and needs explicit review before DDL emission",
        path: [],
      })
    }

    if (Array.isArray(raw?.diagnostics)) {
      for (const item of raw.diagnostics) {
        if (!isRecord(item) || typeof item.code !== "string") {
          continue
        }

        const code = mapPlanDiagnosticCode(item.code)
        const allowed =
          options.allowUnsafe ||
          (code === "unknown" && options.allowUnknown) ||
          (code === "lossy" && options.allowLossy) ||
          (code === "unsupported" && options.allowUnsupported) ||
          (code === "destructive" && options.allowDestructive) ||
          (code === "decision-required" && options.allowDecisionRequired)

        if (allowed) {
          continue
        }

        diagnostics.push({
          code,
          severity: "error",
          message: typeof item.message === "string" ? item.message : "Migration plan diagnostic",
          path: isPath(item.path) ? item.path : [],
          operationId: typeof item.operationId === "string" ? item.operationId : undefined,
        })
      }
    }

    const source = error as { readonly diagnostics?: readonly unknown[] }

    if (Array.isArray(source.diagnostics)) {
      for (const item of source.diagnostics) {
        if (!isRecord(item)) {
          continue
        }

        diagnostics.push({
          code: "invalid-plan",
          severity: "error",
          message:
            typeof item.message === "string" ? item.message : "Migration plan validation failed",
          path: isPath(item.path) ? item.path : [],
        })
      }
    }

    if (diagnostics.length === 0) {
      diagnostics.push({
        code: "invalid-plan",
        severity: "error",
        message: error instanceof Error ? error.message : String(error),
        path: [],
      })
    }

    return sortDiagnostics(diagnostics)
  }

  if (plan.dialect.name !== features.dialect) {
    diagnostics.push({
      code: "dialect-mismatch",
      severity: "error",
      message: `Migration plan dialect "${plan.dialect.name}" does not match the ${features.dialect} DDL emitter`,
      path: ["dialect", "name"],
      dialect: plan.dialect.name,
    })
  }

  if (schemaDialect.name !== features.dialect) {
    diagnostics.push({
      code: "dialect-mismatch",
      severity: "error",
      message: `Schema dialect "${schemaDialect.name}" does not match the ${features.dialect} DDL emitter`,
      path: ["dialect"],
      dialect: schemaDialect.name,
    })
  }

  if (schemaDialect.schema.version !== plan.dialect.version) {
    diagnostics.push({
      code: "dialect-mismatch",
      severity: "error",
      message: `Schema dialect metadata version ${schemaDialect.schema.version} does not match plan dialect version ${plan.dialect.version}`,
      path: ["dialect", "version"],
      dialect: schemaDialect.name,
    })
  }

  if (!plan.ready && !options.allowBlocked && !options.allowUnsafe) {
    diagnostics.push({
      code: "blocked-plan",
      severity: "error",
      message: "Migration plan is blocked and needs explicit review before DDL emission",
      path: [],
    })
  }

  for (const source of plan.diagnostics) {
    const code = source.code
    const allowed =
      options.allowUnsafe ||
      (code === "unknown" && options.allowUnknown) ||
      (code === "lossy" && options.allowLossy) ||
      (code === "unsupported" && options.allowUnsupported) ||
      (code === "destructive" && options.allowDestructive) ||
      (code === "decision-required" && options.allowDecisionRequired)

    if (allowed) {
      continue
    }

    const mapped = mapPlanDiagnosticCode(code)

    diagnostics.push({
      code: mapped,
      severity: "error",
      message: source.message,
      path: source.path,
      operationId: source.operationId,
      kind: source.kind,
      dialect: source.dialect?.name,
    })
  }

  const operationIds = new Set(plan.operations.map((operation) => operation.id))

  for (const operation of plan.operations) {
    if (operation.status === "skipped") {
      continue
    }

    if (operation.dialect.name !== features.dialect) {
      diagnostics.push(
        operationDiagnostic(
          operation,
          "dialect-mismatch",
          `Operation dialect "${operation.dialect.name}" does not match the ${features.dialect} DDL emitter`,
        ),
      )
    }

    if (
      operation.status === "decision-required" &&
      !options.allowDecisionRequired &&
      !options.allowUnsafe
    ) {
      diagnostics.push(
        operationDiagnostic(
          operation,
          "decision-required",
          "Operation needs an explicit safety decision before DDL emission",
        ),
      )
    }

    diagnoseSafety(operation, options, diagnostics)
    diagnoseExecutionContext(operation, options, diagnostics)

    if (operation.type === "custom-sql") {
      if (operation.customSql === undefined || operation.customSql.sql.trim().length === 0) {
        diagnostics.push(
          operationDiagnostic(operation, "custom-sql", "Custom SQL operation has no SQL text"),
        )
      } else if (operation.customSql.dialect.name !== features.dialect) {
        diagnostics.push(
          operationDiagnostic(
            operation,
            "dialect-mismatch",
            `Custom SQL dialect "${operation.customSql.dialect.name}" does not match the ${features.dialect} DDL emitter`,
          ),
        )
      }

      continue
    }

    if (!objectKinds.has(operation.kind)) {
      diagnostics.push(
        operationDiagnostic(
          operation,
          "malformed-operation",
          `Unknown migration operation kind "${String(operation.kind)}"`,
        ),
      )
    }

    if (operation.origin === undefined) {
      diagnostics.push(
        operationDiagnostic(
          operation,
          "malformed-operation",
          "Non-custom operation is missing source origin data",
        ),
      )
    }

    const object = operation.origin?.after ?? operation.origin?.before

    if (object !== undefined && !isRecord(object.value)) {
      diagnostics.push(
        operationDiagnostic(
          operation,
          "malformed-operation",
          "Operation origin value must be an object",
        ),
      )
    }

    if (object !== undefined) {
      const name = operationName(operation, object.value)

      if (name === undefined && requiresPhysicalName(operation.kind)) {
        diagnostics.push(
          operationDiagnostic(
            operation,
            "malformed-operation",
            "Operation object is missing a non-empty physical name",
          ),
        )
      }

      if (name !== undefined && name.trim().length === 0) {
        diagnostics.push(
          operationDiagnostic(
            operation,
            "malformed-operation",
            "Operation physical name cannot be empty",
          ),
        )
      }
    }

    diagnoseVersion(operation, options, features, diagnostics)
    diagnoseOperation(operation, schemaDialect, features, diagnostics)
    for (const dependency of operation.dependsOn) {
      if (!operationIds.has(dependency)) {
        diagnostics.push(
          operationDiagnostic(
            operation,
            "invalid-plan",
            `Operation depends on unknown operation "${dependency}"`,
          ),
        )
      }
    }
  }

  return sortDiagnostics(diagnostics)
}

function diagnoseSafety(
  operation: MigrationOperation,
  options: DdlEmissionOptions,
  diagnostics: DdlDiagnostic[],
): void {
  if (operation.status === "approved" && operation.decision?.action === "allow") {
    return
  }

  const allow =
    options.allowUnsafe ||
    (operation.safety === "unknown" && options.allowUnknown) ||
    (operation.safety === "unsupported" && options.allowUnsupported) ||
    (operation.safety === "destructive" && options.allowDestructive) ||
    (operation.safety === "review-required" && options.allowReviewRequired)

  if (allow) {
    return
  }

  const code = operation.safety

  if (code === "unknown") {
    diagnostics.push(
      operationDiagnostic(
        operation,
        "unknown",
        `Operation has ${code} safety and cannot be emitted without an explicit policy`,
      ),
    )
  } else if (code === "unsupported" || code === "destructive" || code === "review-required") {
    diagnostics.push(
      operationDiagnostic(
        operation,
        code,
        `Operation has ${code} safety and cannot be emitted without an explicit policy`,
      ),
    )
  }
}

function diagnoseExecutionContext(
  operation: MigrationOperation,
  options: DdlEmissionOptions,
  diagnostics: DdlDiagnostic[],
): void {
  if (operation.lock === "unknown") {
    diagnostics.push(
      operationDiagnostic(operation, "lock-conflict", "Operation lock requirement is unknown"),
    )
  } else if (options.lock !== undefined && lockRank[operation.lock] > lockRank[options.lock]) {
    diagnostics.push({
      ...operationDiagnostic(
        operation,
        "lock-conflict",
        `Operation requires a ${operation.lock} lock but the emission policy permits at most ${options.lock} lock`,
      ),
      lock: operation.lock,
    })
  }

  if (operation.transaction === "unknown") {
    diagnostics.push(
      operationDiagnostic(
        operation,
        "transaction-conflict",
        "Operation transaction requirement is unknown",
      ),
    )
  } else if (options.transaction === "autocommit" && operation.transaction === "required") {
    diagnostics.push({
      ...operationDiagnostic(
        operation,
        "transaction-conflict",
        "Operation requires a transaction but the emission policy is autocommit",
      ),
      transaction: operation.transaction,
    })
  } else if (options.transaction === "none" && operation.transaction === "required") {
    diagnostics.push({
      ...operationDiagnostic(
        operation,
        "transaction-conflict",
        "Operation requires a transaction but the emission policy disables transactions",
      ),
      transaction: operation.transaction,
    })
  } else if (options.transaction === "managed" && operation.transaction === "forbidden") {
    diagnostics.push({
      ...operationDiagnostic(
        operation,
        "transaction-conflict",
        "Operation forbids a transaction but the emission policy manages one",
      ),
      transaction: operation.transaction,
    })
  }
}

function diagnoseVersion(
  operation: MigrationOperation,
  options: DdlEmissionOptions,
  features: DdlFeatures,
  diagnostics: DdlDiagnostic[],
): void {
  if (options.serverVersion === undefined) {
    return
  }

  const required = minimumVersion(features.dialect, operation)

  if (required === undefined) {
    return
  }

  const actual = parseVersion(options.serverVersion)

  if (actual === undefined || compareVersion(actual, required) < 0) {
    diagnostics.push({
      ...operationDiagnostic(
        operation,
        "server-version",
        `${features.dialect} ${operation.type} ${operation.kind} requires server version ${required.join(".")}`,
      ),
      requiredVersion: required.join("."),
      actualVersion: String(options.serverVersion),
    })
  }
}

function minimumVersion(
  dialect: DdlFeatures["dialect"],
  operation: MigrationOperation,
): readonly number[] | undefined {
  if (dialect === "sqlite") {
    if (operation.kind === "column" && operation.type === "remove") {
      return [3, 35]
    }

    if (operation.kind === "column" && operation.type === "physical-rename") {
      return [3, 25]
    }

    if (operation.kind === "column" && operation.type === "property-change") {
      return [3, 35]
    }

    if (operation.kind === "table" && operation.type === "property-change") {
      return [3, 35]
    }
  }

  if (dialect === "mysql") {
    if (operation.kind === "column" && operation.type === "physical-rename") {
      return [8, 0]
    }

    if (operation.kind === "constraint" && operation.type === "add") {
      const value = operation.origin?.after?.value

      if (isRecord(value) && value.kind === "check") {
        return [8, 0, 16]
      }
    }
  }

  if (dialect === "postgresql" && operation.kind === "partition" && operation.type === "add") {
    return [10]
  }

  return undefined
}

function diagnoseOperation(
  operation: MigrationOperation,
  schemaDialect: SchemaDialect,
  features: DdlFeatures,
  diagnostics: DdlDiagnostic[],
): void {
  const kind = operation.kind
  const supported = isOperationSupported(features, operation)

  if (!supported) {
    diagnostics.push(
      operationDiagnostic(
        operation,
        operation.safety === "unknown" ? "unknown" : "unsupported",
        `The ${features.dialect} DDL emitter does not support ${kind} operations`,
      ),
    )
  }

  const object = operation.origin?.after ?? operation.origin?.before
  const value = object?.value

  if (!isRecord(value)) {
    return
  }

  if (
    storageDialect(value.storage) !== undefined &&
    storageDialect(value.storage) !== features.dialect
  ) {
    diagnostics.push(
      operationDiagnostic(
        operation,
        "dialect-mismatch",
        `Storage declaration belongs to ${storageDialect(value.storage)} but the emitter is ${features.dialect}`,
      ),
    )
  }

  for (const expression of expressionsIn(value)) {
    if (expression.dialect !== undefined && expression.dialect !== features.dialect) {
      diagnostics.push(
        operationDiagnostic(
          operation,
          "dialect-mismatch",
          `Expression is tagged for ${expression.dialect} but the emitter is ${features.dialect}`,
        ),
      )
    }

    if (expression.sql.includes("?")) {
      diagnostics.push(
        operationDiagnostic(
          operation,
          "malformed-operation",
          "Schema expressions must be parameter-free",
        ),
      )
    }

    if (
      expression.expressionKind.toLowerCase().startsWith("json") &&
      !schemaDialect.capabilities?.includes("json")
    ) {
      diagnostics.push(
        operationDiagnostic(
          operation,
          "capability",
          "This schema expression requires the dialect JSON capability",
        ),
      )
    }
  }

  if (value.generatedColumn !== undefined && !features.supports.has("generated-column")) {
    diagnostics.push(
      operationDiagnostic(
        operation,
        "unsupported",
        "Generated columns are not supported by this DDL emitter",
      ),
    )
  }

  if (value.predicate !== undefined && !features.supports.has("index-predicate")) {
    diagnostics.push(
      operationDiagnostic(
        operation,
        "unsupported",
        "Index predicates are not supported by this DDL emitter",
      ),
    )
  }

  if (
    value.includedColumns !== undefined &&
    Array.isArray(value.includedColumns) &&
    value.includedColumns.length > 0 &&
    !features.supports.has("index-include")
  ) {
    diagnostics.push(
      operationDiagnostic(
        operation,
        "unsupported",
        "Included index columns are not supported by this DDL emitter",
      ),
    )
  }

  if (kind === "opaque-object" || kind === "deferred-object") {
    diagnostics.push(
      operationDiagnostic(
        operation,
        "lossy",
        "Opaque and deferred catalog facts never become inferred SQL",
      ),
    )
  }
}

function isOperationSupported(features: DdlFeatures, operation: MigrationOperation): boolean {
  if (!features.supports.has(operation.kind)) {
    return false
  }

  if (operation.kind === "table" && operation.type === "property-change") {
    return false
  }

  if (operation.kind === "ownership" && operation.type === "remove") {
    return false
  }

  if (operation.kind === "namespace" && features.dialect !== "postgresql") {
    return false
  }

  if (operation.kind === "comment" && features.dialect === "sqlite") {
    return false
  }

  if (
    operation.kind === "constraint" &&
    features.dialect === "sqlite" &&
    (operation.type === "add" || operation.type === "remove")
  ) {
    return false
  }

  if (operation.kind === "materialized-view" && features.dialect !== "postgresql") {
    return false
  }

  if (operation.kind === "routine" && operation.type === "physical-rename") {
    return false
  }

  if (
    operation.kind === "view" &&
    operation.type === "physical-rename" &&
    features.dialect === "sqlite"
  ) {
    return false
  }

  if (
    operation.kind === "constraint" &&
    operation.type === "physical-rename" &&
    features.dialect !== "postgresql"
  ) {
    return false
  }

  if (operation.kind === "trigger" && operation.type === "physical-rename") {
    return false
  }

  if (operation.kind === "policy" && operation.type === "property-change") {
    return false
  }

  if (operation.kind === "extension" && operation.type === "property-change") {
    return false
  }

  if (operation.kind === "partition" && operation.type === "physical-rename") {
    return false
  }

  if (operation.kind === "ownership" && operation.type === "physical-rename") {
    return false
  }

  return true
}

function renderOperation(
  operation: MigrationOperation,
  operations: readonly MigrationOperation[],
  dialect: SchemaDialect,
  features: DdlFeatures,
): string | undefined {
  if (operation.type === "custom-sql") {
    return normalizeSql(operation.customSql?.sql ?? "")
  }

  const object =
    operation.type === "remove"
      ? operation.origin?.before
      : (operation.origin?.after ?? operation.origin?.before)

  if (object === undefined) {
    return undefined
  }

  const value = object.value

  switch (operation.type) {
    case "add": {
      return renderAdd(operation, value, operations, dialect, features)
    }

    case "remove": {
      return renderRemove(operation, value, operations, dialect, features)
    }

    case "physical-rename": {
      return renderRename(operation, operations, dialect, features)
    }

    case "property-change": {
      return renderPropertyChange(operation, value, operations, dialect, features)
    }

    default: {
      return undefined
    }
  }
}

function renderAdd(
  operation: MigrationOperation,
  value: unknown,
  operations: readonly MigrationOperation[],
  dialect: SchemaDialect,
  features: DdlFeatures,
): string | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const name = requiredName(operation, value)

  switch (operation.kind) {
    case "namespace": {
      return features.dialect === "postgresql"
        ? `CREATE SCHEMA ${dialect.quoteIdentifier(name)}`
        : undefined
    }

    case "table": {
      return renderCreateTable(operation, value, dialect, features)
    }

    case "column": {
      return `ALTER TABLE ${parentTable(operation, operations, dialect)} ADD COLUMN ${renderColumn(value, dialect, features)}`
    }

    case "constraint": {
      return renderAddConstraint(operation, value, operations, dialect, features)
    }

    case "index": {
      return renderCreateIndex(operation, value, operations, dialect, features)
    }

    case "view":
    case "materialized-view": {
      return renderCreateView(operation, value, dialect, features)
    }

    case "sequence": {
      return renderCreateSequence(operation, value, dialect, features)
    }

    case "enum": {
      return renderCreateEnum(operation, value, dialect, features)
    }

    case "domain": {
      return renderCreateDomain(operation, value, dialect, features)
    }

    case "collation": {
      return renderCreateCollation(operation, value, dialect, features)
    }

    case "trigger": {
      return renderCreateTrigger(operation, value, operations, dialect, features)
    }

    case "routine": {
      return renderCreateRoutine(operation, value, dialect, features)
    }

    case "partition": {
      return renderCreatePartition(operation, value, operations, dialect, features)
    }

    case "policy": {
      return renderCreatePolicy(operation, value, operations, dialect, features)
    }

    case "extension": {
      return renderCreateExtension(operation, value, dialect, features)
    }

    case "comment": {
      return renderComment(operation, value, dialect, features)
    }

    case "ownership": {
      return renderOwnership(operation, value, dialect, features)
    }

    default: {
      return undefined
    }
  }
}

function renderRemove(
  operation: MigrationOperation,
  value: unknown,
  operations: readonly MigrationOperation[],
  dialect: SchemaDialect,
  features: DdlFeatures,
): string | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const name = requiredName(operation, value)

  switch (operation.kind) {
    case "namespace": {
      return features.dialect === "postgresql"
        ? `DROP SCHEMA ${dialect.quoteIdentifier(name)}`
        : undefined
    }

    case "table": {
      return `DROP TABLE ${qualifiedName(operation, name, dialect)}`
    }

    case "column": {
      return `ALTER TABLE ${parentTable(operation, operations, dialect)} DROP COLUMN ${dialect.quoteIdentifier(name)}`
    }

    case "constraint": {
      return renderDropConstraint(operation, value, operations, dialect, features)
    }

    case "index": {
      return renderDropIndex(operation, value, operations, dialect, features)
    }

    case "view": {
      return `DROP VIEW ${qualifiedName(operation, name, dialect)}`
    }

    case "materialized-view": {
      return features.dialect === "postgresql"
        ? `DROP MATERIALIZED VIEW ${qualifiedName(operation, name, dialect)}`
        : undefined
    }

    case "sequence": {
      return features.dialect === "postgresql"
        ? `DROP SEQUENCE ${qualifiedName(operation, name, dialect)}`
        : undefined
    }

    case "enum": {
      return features.dialect === "postgresql"
        ? `DROP TYPE ${qualifiedName(operation, name, dialect)}`
        : undefined
    }

    case "domain": {
      return features.dialect === "postgresql"
        ? `DROP DOMAIN ${qualifiedName(operation, name, dialect)}`
        : undefined
    }

    case "collation": {
      return `DROP COLLATION ${qualifiedName(operation, name, dialect)}`
    }

    case "trigger": {
      return `DROP TRIGGER ${qualifiedName(operation, name, dialect)}`
    }

    case "routine": {
      return renderDropRoutine(operation, value, dialect, features)
    }

    case "partition": {
      return renderDropPartition(operation, value, operations, dialect, features)
    }

    case "policy": {
      return features.dialect === "postgresql"
        ? `DROP POLICY ${dialect.quoteIdentifier(name)} ON ${tableReference(operation, value.table, operations, dialect)}`
        : undefined
    }

    case "extension": {
      return features.dialect === "postgresql"
        ? `DROP EXTENSION ${dialect.quoteIdentifier(extensionName(value, name))}`
        : undefined
    }

    case "comment": {
      return renderComment(
        operation,
        {
          ...value,
          text: null,
        },
        dialect,
        features,
      )
    }

    case "ownership": {
      return undefined
    }

    default: {
      return undefined
    }
  }
}

function renderPropertyChange(
  operation: MigrationOperation,
  value: unknown,
  operations: readonly MigrationOperation[],
  dialect: SchemaDialect,
  features: DdlFeatures,
): string | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  if (operation.kind === "comment" || operation.kind === "ownership") {
    return operation.kind === "comment"
      ? renderComment(operation, value, dialect, features)
      : renderOwnership(operation, value, dialect, features)
  }

  if (operation.kind === "column") {
    return renderAlterColumn(operation, value, operations, dialect, features)
  }

  if (operation.kind === "index") {
    const before = operation.origin?.before?.value
    const dropped =
      before === undefined
        ? undefined
        : renderDropIndex(operation, before, operations, dialect, features)
    const created = renderCreateIndex(operation, value, operations, dialect, features)

    if (dropped === undefined) {
      return created
    }

    if (created === undefined) {
      return dropped
    }

    return `${dropped};\n${created}`
  }

  if (operation.kind === "view" || operation.kind === "materialized-view") {
    return renderReplaceView(operation, value, dialect, features)
  }

  if (operation.kind === "routine") {
    const before = operation.origin?.before?.value
    const dropped =
      before === undefined ? undefined : renderDropRoutine(operation, before, dialect, features)
    const created = renderCreateRoutine(operation, value, dialect, features)

    if (dropped === undefined) {
      return created
    }

    if (created === undefined) {
      return dropped
    }

    return `${dropped};\n${created}`
  }

  return undefined
}

function renderRename(
  operation: MigrationOperation,
  operations: readonly MigrationOperation[],
  dialect: SchemaDialect,
  features: DdlFeatures,
): string | undefined {
  const before = operation.origin?.before
  const after = operation.origin?.after

  if (before === undefined || after === undefined) {
    return undefined
  }

  const oldName = requiredValueName(before.value)
  const newName = requiredValueName(after.value)
  const oldQualified = qualifiedName(operation, oldName, dialect)
  const quotedNew = dialect.quoteIdentifier(newName)

  switch (operation.kind) {
    case "namespace": {
      return features.dialect === "postgresql"
        ? `ALTER SCHEMA ${dialect.quoteIdentifier(oldName)} RENAME TO ${quotedNew}`
        : undefined
    }

    case "table": {
      return `ALTER TABLE ${oldQualified} RENAME TO ${quotedNew}`
    }

    case "column": {
      return `ALTER TABLE ${parentTable(operation, operations, dialect)} RENAME COLUMN ${dialect.quoteIdentifier(oldName)} TO ${quotedNew}`
    }

    case "constraint": {
      return features.dialect === "postgresql"
        ? `ALTER TABLE ${parentTable(operation, operations, dialect)} RENAME CONSTRAINT ${dialect.quoteIdentifier(oldName)} TO ${quotedNew}`
        : undefined
    }

    case "index": {
      if (features.dialect === "postgresql") {
        return `ALTER INDEX ${oldQualified} RENAME TO ${quotedNew}`
      }

      if (features.dialect === "mysql") {
        return `ALTER TABLE ${parentTable(operation, operations, dialect)} RENAME INDEX ${dialect.quoteIdentifier(oldName)} TO ${quotedNew}`
      }

      return undefined
    }

    case "view": {
      return features.dialect === "mysql"
        ? `RENAME TABLE ${oldQualified} TO ${qualifiedName(operation, newName, dialect)}`
        : `ALTER VIEW ${oldQualified} RENAME TO ${quotedNew}`
    }

    case "materialized-view": {
      return features.dialect === "postgresql"
        ? `ALTER MATERIALIZED VIEW ${oldQualified} RENAME TO ${quotedNew}`
        : undefined
    }

    case "sequence": {
      return features.dialect === "postgresql"
        ? `ALTER SEQUENCE ${oldQualified} RENAME TO ${quotedNew}`
        : undefined
    }

    case "enum":
    case "domain": {
      return features.dialect === "postgresql"
        ? `ALTER TYPE ${oldQualified} RENAME TO ${quotedNew}`
        : undefined
    }

    case "collation": {
      return features.dialect === "postgresql"
        ? `ALTER COLLATION ${oldQualified} RENAME TO ${quotedNew}`
        : undefined
    }

    default: {
      return undefined
    }
  }
}

function renderCreateTable(
  operation: MigrationOperation,
  value: JsonRecord,
  dialect: SchemaDialect,
  features: DdlFeatures,
): string {
  const columns = arrayOfRecords(value.columns)
  const definitions = columns.map((column) => renderColumn(column, dialect, features))
  const name = requiredName(operation, value)

  return `CREATE TABLE ${qualifiedName(operation, name, dialect)} (${definitions.join(", ")})`
}

function renderColumn(value: JsonRecord, dialect: SchemaDialect, features: DdlFeatures): string {
  const name = stringValue(value.physicalName) ?? stringValue(value.id)

  if (name === undefined) {
    throw new TypeError("Column is missing a physical name")
  }

  const parts = [dialect.quoteIdentifier(name), renderStorage(value.storage, dialect)]

  if (value.generatedColumn !== undefined) {
    const generated = recordValue(value.generatedColumn)

    if (generated === undefined) {
      throw new TypeError("Generated column declaration is malformed")
    }

    const expression = expressionValue(generated.expression)

    if (expression === undefined) {
      throw new TypeError("Generated column is missing its expression")
    }

    parts.push(
      `GENERATED ALWAYS AS (${expression.sql}) ${generated.mode === "virtual" ? "VIRTUAL" : "STORED"}`,
    )
  }

  if (value.nullable === false) {
    parts.push("NOT NULL")
  }

  if (value.default !== undefined) {
    const rendered = renderDefault(value.default, dialect)

    parts.push(`DEFAULT ${rendered}`)
  } else if (value.hasDefault === true) {
    throw new TypeError("Column declares a default but no default value was retained")
  }

  const identity = recordValue(value.identity)

  if (identity !== undefined) {
    if (features.dialect === "postgresql") {
      parts.push(
        `GENERATED ${identity.generation === "always" ? "ALWAYS" : "BY DEFAULT"} AS IDENTITY`,
      )
    } else if (features.dialect === "mysql") {
      parts.push("AUTO_INCREMENT")
    } else {
      throw new TypeError("SQLite identity declarations are not supported by this emitter")
    }
  }

  if (value.onUpdate !== undefined) {
    const expression = expressionValue(value.onUpdate)

    if (expression === undefined) {
      throw new TypeError("Column onUpdate value is malformed")
    }

    if (features.dialect !== "mysql") {
      throw new TypeError(
        `${features.dialect} does not support MySQL ON UPDATE column declarations`,
      )
    }

    parts.push(`ON UPDATE ${expression.sql}`)
  }

  return parts.join(" ")
}

function renderStorage(value: unknown, dialect: SchemaDialect): string {
  const storage = recordValue(value)

  if (storage === undefined) {
    return "TEXT"
  }

  if (storage.kind === "native") {
    const type = stringValue(storage.type)

    if (type === undefined || type.trim().length === 0) {
      throw new TypeError("Native storage declaration must have a non-empty type")
    }

    return type
  }

  if (storage.kind !== "portable") {
    throw new TypeError("Column storage kind is invalid")
  }

  const type = stringValue(storage.type)

  if (type === undefined) {
    throw new TypeError("Portable storage declaration is missing its type")
  }

  const key = type.toLowerCase()
  const map: Record<string, string> =
    dialect.name === "postgresql"
      ? {
          integer: "INTEGER",
          numeric: "NUMERIC",
          text: "TEXT",
          boolean: "BOOLEAN",
          date: "DATE",
          timestamp: "TIMESTAMP",
          uuid: "UUID",
          json: "JSONB",
          bigint: "BIGINT",
          binary: "BYTEA",
        }
      : dialect.name === "mysql"
        ? {
            integer: "INT",
            numeric: "DECIMAL",
            text: "TEXT",
            boolean: "BOOLEAN",
            date: "DATE",
            timestamp: "DATETIME",
            uuid: "CHAR(36)",
            json: "JSON",
            bigint: "BIGINT",
            binary: "VARBINARY",
          }
        : {
            integer: "INTEGER",
            numeric: "NUMERIC",
            text: "TEXT",
            boolean: "INTEGER",
            date: "TEXT",
            timestamp: "TEXT",
            uuid: "TEXT",
            json: "TEXT",
            bigint: "INTEGER",
            binary: "BLOB",
          }
  const rendered = map[key]

  if (rendered === undefined) {
    throw new TypeError(`Unsupported portable storage type "${type}" for ${dialect.name}`)
  }

  return rendered
}

function renderDefault(value: unknown, dialect: SchemaDialect): string {
  const descriptor = recordValue(value)

  if (descriptor === undefined) {
    throw new TypeError("Default declaration is malformed")
  }

  if (descriptor.kind === "external") {
    throw new TypeError("External defaults are lossy and cannot be rendered")
  }

  if (descriptor.kind === "expression") {
    const expression = expressionValue(descriptor.expression)

    if (expression === undefined) {
      throw new TypeError("Default expression is malformed")
    }

    return expression.sql
  }

  if (descriptor.kind !== "literal") {
    throw new TypeError("Default declaration kind is invalid")
  }

  return renderLiteral(descriptor.value, dialect)
}

function renderLiteral(value: unknown, dialect: SchemaDialect): string {
  const literal = recordValue(value)

  if (literal === undefined) {
    throw new TypeError("Literal declaration is malformed")
  }

  switch (literal.kind) {
    case "null": {
      return "NULL"
    }

    case "boolean": {
      return schemaLiteral(dialect, literal.value === true)
    }

    case "string": {
      if (typeof literal.value !== "string") {
        throw new TypeError("String literal value is malformed")
      }

      return schemaLiteral(dialect, literal.value)
    }

    case "number":
    case "bigint": {
      if (
        typeof literal.value !== "string" ||
        !/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/u.test(literal.value)
      ) {
        throw new TypeError("Numeric literal value is not canonical")
      }

      return literal.value
    }

    default: {
      throw new TypeError("Literal kind is invalid")
    }
  }
}

function schemaLiteral(dialect: SchemaDialect, value: unknown): string {
  const rendered = dialect.renderSchemaLiteral?.(value)

  if (rendered !== undefined) {
    if (rendered.includes("?")) {
      throw new TypeError("Schema literal renderer returned a parameter placeholder")
    }

    return rendered
  }

  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE"
  }

  if (typeof value === "string") {
    return `'${value.replaceAll("'", "''")}'`
  }

  if (value === null) {
    return "NULL"
  }

  throw new TypeError("Unsupported schema literal")
}

function renderAddConstraint(
  operation: MigrationOperation,
  value: JsonRecord,
  operations: readonly MigrationOperation[],
  dialect: SchemaDialect,
  features: DdlFeatures,
): string | undefined {
  const table = parentTable(operation, operations, dialect)
  const name = requiredName(operation, value)
  const kind = stringValue(value.kind)
  const columns = stringArray(value.columns)
  const terms = columns.map((column) => dialect.quoteIdentifier(column)).join(", ")
  let body: string

  if (kind === "primary-key") {
    body = `PRIMARY KEY (${terms})`
  } else if (kind === "unique" || kind === "unique-constraint") {
    body = `UNIQUE (${terms})`
  } else if (kind === "foreign-key") {
    const target = recordValue(value.target)
    const targetTable = target === undefined ? undefined : recordValue(target.table)
    const targetName =
      targetTable === undefined
        ? undefined
        : (stringValue(targetTable.id) ?? stringValue(targetTable.physicalName))
    const targetColumns = target === undefined ? [] : stringArray(target.columns)

    if (targetName === undefined || columns.length === 0 || targetColumns.length === 0) {
      throw new TypeError("Foreign-key constraint is missing target identity")
    }

    body = `FOREIGN KEY (${terms}) REFERENCES ${qualifiedName(operation, targetName, dialect)} (${targetColumns.map((column) => dialect.quoteIdentifier(column)).join(", ")})`
    const onDelete = stringValue(value.onDelete)
    const onUpdate = stringValue(value.onUpdate)

    if (onDelete !== undefined && onDelete !== "no-action") {
      body += ` ON DELETE ${sqlAction(onDelete)}`
    }

    if (onUpdate !== undefined && onUpdate !== "no-action") {
      body += ` ON UPDATE ${sqlAction(onUpdate)}`
    }
  } else if (kind === "check") {
    const expression = expressionValue(value.expression)

    if (expression === undefined) {
      throw new TypeError("Check constraint is missing its expression")
    }

    body = `CHECK (${expression.sql})`
  } else {
    throw new TypeError(`Unsupported constraint kind "${String(kind)}"`)
  }

  const deferrable = value.deferrable === true

  if (deferrable) {
    if (features.dialect === "postgresql") {
      body += " DEFERRABLE"
      if (value.initially === "deferred") {
        body += " INITIALLY DEFERRED"
      } else if (value.initially === "immediate") {
        body += " INITIALLY IMMEDIATE"
      }
    } else {
      throw new TypeError(`${features.dialect} does not support deferrable constraints`)
    }
  }

  return `ALTER TABLE ${table} ADD CONSTRAINT ${dialect.quoteIdentifier(name)} ${body}`
}

function renderDropConstraint(
  operation: MigrationOperation,
  value: JsonRecord,
  operations: readonly MigrationOperation[],
  dialect: SchemaDialect,
  features: DdlFeatures,
): string | undefined {
  const table = parentTable(operation, operations, dialect)
  const name = requiredName(operation, value)
  const kind = stringValue(value.kind)

  if (features.dialect === "postgresql") {
    return `ALTER TABLE ${table} DROP CONSTRAINT ${dialect.quoteIdentifier(name)}`
  }

  if (features.dialect === "mysql") {
    if (kind === "primary-key") {
      return `ALTER TABLE ${table} DROP PRIMARY KEY`
    }

    if (kind === "foreign-key") {
      return `ALTER TABLE ${table} DROP FOREIGN KEY ${dialect.quoteIdentifier(name)}`
    }

    return `ALTER TABLE ${table} DROP INDEX ${dialect.quoteIdentifier(name)}`
  }

  throw new TypeError("SQLite cannot drop table constraints without rebuilding the table")
}

function renderCreateIndex(
  operation: MigrationOperation,
  value: JsonRecord,
  operations: readonly MigrationOperation[],
  dialect: SchemaDialect,
  features: DdlFeatures,
): string | undefined {
  const name = requiredName(operation, value)
  const terms = arrayOfRecords(value.terms)
    .sort((left, right) => numberValue(left.position) - numberValue(right.position))
    .map((term) => renderIndexTerm(term, dialect))
    .join(", ")

  if (terms.length === 0) {
    throw new TypeError("Index must contain at least one term")
  }

  const table = parentTable(operation, operations, dialect)
  let sql = `CREATE ${value.unique === true ? "UNIQUE " : ""}INDEX ${qualifiedName(operation, name, dialect)} ON ${table}`
  const method = recordValue(value.dialect)?.method

  if (features.dialect === "postgresql" && typeof method === "string") {
    sql += ` USING ${method}`
  }

  sql += ` (${terms})`
  const included = stringArray(value.includedColumns)

  if (included.length > 0) {
    sql += ` INCLUDE (${included.map((column) => dialect.quoteIdentifier(column)).join(", ")})`
  }

  const predicate = expressionValue(value.predicate)

  if (predicate !== undefined) {
    sql += ` WHERE ${predicate.sql}`
  }

  return sql
}

function renderIndexTerm(value: JsonRecord, dialect: SchemaDialect): string {
  const kind = stringValue(value.kind)
  let sql: string

  if (kind === "column") {
    const column = stringValue(value.column)

    if (column === undefined) {
      throw new TypeError("Index column term is missing its column")
    }

    sql = dialect.quoteIdentifier(column)
  } else if (kind === "expression") {
    const expression = expressionValue(value.expression)

    if (expression === undefined) {
      throw new TypeError("Index expression term is malformed")
    }

    sql = `(${expression.sql})`
  } else {
    throw new TypeError(`Unsupported index term kind "${String(kind)}"`)
  }

  const direction = stringValue(value.direction)

  if (direction === "ASC" || direction === "DESC") {
    sql += ` ${direction}`
  }

  const nulls = stringValue(value.nulls)

  if (nulls === "FIRST" || nulls === "LAST") {
    sql += ` NULLS ${nulls}`
  }

  return sql
}

function renderDropIndex(
  operation: MigrationOperation,
  value: JsonRecord,
  operations: readonly MigrationOperation[],
  dialect: SchemaDialect,
  features: DdlFeatures,
): string | undefined {
  const name = requiredName(operation, value)

  if (features.dialect === "mysql") {
    return `ALTER TABLE ${parentTable(operation, operations, dialect)} DROP INDEX ${dialect.quoteIdentifier(name)}`
  }

  return `DROP INDEX ${qualifiedName(operation, name, dialect)}`
}

function renderCreateView(
  operation: MigrationOperation,
  value: JsonRecord,
  dialect: SchemaDialect,
  features: DdlFeatures,
): string | undefined {
  const name = requiredName(operation, value)
  const definition = expressionValue(value.definition)

  if (definition === undefined) {
    throw new TypeError("View is missing its definition")
  }

  if (operation.kind === "materialized-view" && features.dialect !== "postgresql") {
    throw new TypeError(`${features.dialect} does not support materialized views`)
  }

  let sql = `CREATE ${operation.kind === "materialized-view" ? "MATERIALIZED " : ""}VIEW ${qualifiedName(operation, name, dialect)}`
  const columns = arrayOfRecords(value.columns)

  if (columns.length > 0) {
    sql += ` (${columns.map((column) => dialect.quoteIdentifier(requiredValueName(column))).join(", ")})`
  }

  sql += ` AS ${definition.sql}`
  const checkOption = stringValue(value.checkOption)

  if (checkOption === "local") {
    sql += " WITH LOCAL CHECK OPTION"
  } else if (checkOption === "cascaded") {
    sql += " WITH CASCADED CHECK OPTION"
  }

  return sql
}

function renderReplaceView(
  operation: MigrationOperation,
  value: JsonRecord,
  dialect: SchemaDialect,
  features: DdlFeatures,
): string | undefined {
  const name = requiredName(operation, value)
  const definition = expressionValue(value.definition)

  if (definition === undefined) {
    throw new TypeError("View is missing its definition")
  }

  if (operation.kind === "materialized-view") {
    if (features.dialect !== "postgresql") {
      throw new TypeError(`${features.dialect} cannot replace materialized views`)
    }

    return `DROP MATERIALIZED VIEW ${qualifiedName(operation, name, dialect)};\n${renderCreateView(operation, value, dialect, features)}`
  }

  if (features.dialect === "postgresql" || features.dialect === "mysql") {
    return `CREATE OR REPLACE VIEW ${qualifiedName(operation, name, dialect)} AS ${definition.sql}`
  }

  throw new TypeError("SQLite cannot alter a view definition without an explicit rebuild")
}

function renderCreateSequence(
  operation: MigrationOperation,
  value: JsonRecord,
  dialect: SchemaDialect,
  features: DdlFeatures,
): string | undefined {
  if (features.dialect !== "postgresql") {
    throw new TypeError(`${features.dialect} does not support sequences`)
  }

  const name = requiredName(operation, value)
  const parts = [`CREATE SEQUENCE ${qualifiedName(operation, name, dialect)}`]
  const options: readonly [string, string][] = [
    ["start", "START WITH"],
    ["increment", "INCREMENT BY"],
    ["minimum", "MINVALUE"],
    ["maximum", "MAXVALUE"],
    ["cache", "CACHE"],
  ]

  for (const [key, keyword] of options) {
    const fact = recordValue(value[key])

    if (fact === undefined) {
      continue
    }

    parts.push(`${keyword} ${renderValueFact(fact, dialect)}`)
  }

  if (value.cycle === true) {
    parts.push("CYCLE")
  } else if (value.cycle === false) {
    parts.push("NO CYCLE")
  }

  return parts.join(" ")
}

function renderCreateEnum(
  operation: MigrationOperation,
  value: JsonRecord,
  dialect: SchemaDialect,
  features: DdlFeatures,
): string | undefined {
  if (features.dialect !== "postgresql") {
    throw new TypeError(`${features.dialect} does not support standalone enum types`)
  }

  const name = requiredName(operation, value)
  const values = arrayOfRecords(value.values).sort(
    (left, right) => numberValue(left.ordinalPosition) - numberValue(right.ordinalPosition),
  )

  if (values.length === 0) {
    throw new TypeError("Enum must contain at least one value")
  }

  return `CREATE TYPE ${qualifiedName(operation, name, dialect)} AS ENUM (${values.map((item) => schemaLiteral(dialect, item.value)).join(", ")})`
}

function renderCreateDomain(
  operation: MigrationOperation,
  value: JsonRecord,
  dialect: SchemaDialect,
  features: DdlFeatures,
): string | undefined {
  if (features.dialect !== "postgresql") {
    throw new TypeError(`${features.dialect} does not support domains`)
  }

  const name = requiredName(operation, value)
  let sql = `CREATE DOMAIN ${qualifiedName(operation, name, dialect)} AS ${renderStorage(value.storage, dialect)}`

  if (value.nullable === false) {
    sql += " NOT NULL"
  }

  if (value.default !== undefined) {
    sql += ` DEFAULT ${renderValueFact(recordValue(value.default) ?? {}, dialect)}`
  }

  return sql
}

function renderCreateCollation(
  operation: MigrationOperation,
  value: JsonRecord,
  dialect: SchemaDialect,
  features: DdlFeatures,
): string | undefined {
  const name = requiredName(operation, value)

  if (features.dialect === "sqlite") {
    throw new TypeError("SQLite does not support named collations in DDL")
  }

  const locale = stringValue(value.locale)
  const provider = stringValue(value.provider)

  if (features.dialect === "postgresql") {
    if (locale === undefined) {
      throw new TypeError("PostgreSQL collation is missing its locale")
    }

    return `CREATE COLLATION ${qualifiedName(operation, name, dialect)} (LOCALE = ${schemaLiteral(dialect, locale)}${provider === undefined ? "" : `, PROVIDER = ${schemaLiteral(dialect, provider)}`})`
  }

  if (locale === undefined) {
    throw new TypeError("MySQL collation is missing its locale")
  }

  throw new TypeError("MySQL collations are server metadata and cannot be created as named objects")
}

function renderCreateTrigger(
  operation: MigrationOperation,
  value: JsonRecord,
  operations: readonly MigrationOperation[],
  dialect: SchemaDialect,
  features: DdlFeatures,
): string | undefined {
  const name = requiredName(operation, value)
  const table = tableReference(operation, value.table, operations, dialect)
  const timing = stringValue(value.timing)
  const events = stringArray(value.events)
  const body = expressionValue(value.body)

  if (timing === undefined || body === undefined || events.length === 0) {
    throw new TypeError("Trigger is missing timing, events, or body")
  }

  if (timing === "unknown") {
    throw new TypeError("Trigger timing is unknown")
  }

  const supportedEvents = events.map((event) => event.toUpperCase()).join(" OR ")
  const orientation = stringValue(value.orientation)

  if (features.dialect === "mysql" && orientation === "statement") {
    throw new TypeError("MySQL triggers only support row orientation")
  }

  let sql = `CREATE TRIGGER ${qualifiedName(operation, name, dialect)} ${timing.toUpperCase()} ${supportedEvents} ON ${table} FOR EACH ${orientation === "statement" ? "STATEMENT" : "ROW"} ${body.sql}`
  const condition = expressionValue(value.condition)

  if (condition !== undefined) {
    sql += ` WHEN (${condition.sql})`
  }

  return sql
}

function renderCreateRoutine(
  operation: MigrationOperation,
  value: JsonRecord,
  dialect: SchemaDialect,
  features: DdlFeatures,
): string | undefined {
  if (features.dialect === "sqlite") {
    throw new TypeError("SQLite does not support stored routines")
  }

  const name = requiredName(operation, value)
  const kind = stringValue(value.routineKind)

  if (kind !== "function" && kind !== "procedure") {
    throw new TypeError(`Routine kind "${String(kind)}" is not supported by this emitter`)
  }

  const parameters = arrayOfRecords(value.parameters)
    .sort((left, right) => numberValue(left.ordinalPosition) - numberValue(right.ordinalPosition))
    .map((parameter) => renderRoutineParameter(parameter, dialect))
    .join(", ")
  const body = expressionValue(value.body)

  if (body === undefined) {
    throw new TypeError("Routine body is missing")
  }

  let sql = `CREATE ${kind.toUpperCase()} ${qualifiedName(operation, name, dialect)}(${parameters})`

  if (kind === "function") {
    const returnType = renderStorage(value.returnType, dialect)

    sql += ` RETURNS ${returnType}`
  }

  const language = stringValue(value.language)

  if (features.dialect === "postgresql") {
    sql += ` LANGUAGE ${dialect.quoteIdentifier(language ?? "sql")} AS ${dollarQuote(body.sql)}`
  } else {
    sql += ` ${body.sql}`
  }

  return sql
}

function renderRoutineParameter(value: JsonRecord, dialect: SchemaDialect): string {
  const name = stringValue(value.name)
  const mode = stringValue(value.mode)
  const storage = renderStorage(value.storage, dialect)

  return `${mode === undefined || mode === "in" ? "" : `${mode.toUpperCase()} `}${name === undefined ? "" : `${dialect.quoteIdentifier(name)} `}${storage}`.trim()
}

function renderDropRoutine(
  operation: MigrationOperation,
  value: JsonRecord,
  dialect: SchemaDialect,
  features: DdlFeatures,
): string | undefined {
  if (features.dialect === "sqlite") {
    throw new TypeError("SQLite does not support stored routines")
  }

  const kind = stringValue(value.routineKind)

  if (kind !== "function" && kind !== "procedure") {
    throw new TypeError("Routine kind is unknown")
  }

  return `DROP ${kind.toUpperCase()} ${qualifiedName(operation, requiredName(operation, value), dialect)}`
}

function renderCreatePartition(
  operation: MigrationOperation,
  value: JsonRecord,
  operations: readonly MigrationOperation[],
  dialect: SchemaDialect,
  features: DdlFeatures,
): string | undefined {
  const name = requiredName(operation, value)
  const parent = recordValue(value.parent)

  if (parent === undefined) {
    throw new TypeError("Partition is missing its parent table")
  }

  const strategy = stringValue(value.strategy)
  const bound = expressionValue(value.bound)

  if (features.dialect === "postgresql") {
    if (strategy === undefined || strategy === "unknown" || bound === undefined) {
      throw new TypeError("PostgreSQL partition requires strategy and bound")
    }

    return `CREATE TABLE ${qualifiedName(operation, name, dialect)} PARTITION OF ${tableReference(operation, value.parent, operations, dialect)} FOR VALUES ${bound.sql}`
  }

  if (features.dialect === "mysql") {
    if (bound === undefined) {
      throw new TypeError("MySQL partition requires a bound expression")
    }

    return `ALTER TABLE ${tableReference(operation, value.parent, operations, dialect)} ADD PARTITION (PARTITION ${dialect.quoteIdentifier(name)} VALUES ${bound.sql})`
  }

  throw new TypeError("SQLite does not support table partitions")
}

function renderDropPartition(
  operation: MigrationOperation,
  value: JsonRecord,
  operations: readonly MigrationOperation[],
  dialect: SchemaDialect,
  features: DdlFeatures,
): string | undefined {
  const name = requiredName(operation, value)

  if (features.dialect === "postgresql") {
    return `DROP TABLE ${qualifiedName(operation, name, dialect)}`
  }

  if (features.dialect === "mysql") {
    return `ALTER TABLE ${tableReference(operation, value.parent, operations, dialect)} DROP PARTITION ${dialect.quoteIdentifier(name)}`
  }

  throw new TypeError("SQLite does not support table partitions")
}

function renderCreatePolicy(
  operation: MigrationOperation,
  value: JsonRecord,
  operations: readonly MigrationOperation[],
  dialect: SchemaDialect,
  features: DdlFeatures,
): string | undefined {
  if (features.dialect !== "postgresql") {
    throw new TypeError(`${features.dialect} does not support row-level policies`)
  }

  const name = requiredName(operation, value)
  const command = stringValue(value.command)

  if (command === undefined || command === "unknown") {
    throw new TypeError("Policy command is unknown")
  }

  let sql = `CREATE POLICY ${dialect.quoteIdentifier(name)} ON ${tableReference(operation, value.table, operations, dialect)}`

  if (command !== "all") {
    sql += ` FOR ${command.toUpperCase()}`
  }

  const roles = stringArray(value.roles)

  if (roles.length > 0) {
    sql += ` TO ${roles.map((role) => dialect.quoteIdentifier(role)).join(", ")}`
  }

  const using = expressionValue(value.using)
  const check = expressionValue(value.check)

  if (using !== undefined) {
    sql += ` USING (${using.sql})`
  }

  if (check !== undefined) {
    sql += ` WITH CHECK (${check.sql})`
  }

  return sql
}

function renderCreateExtension(
  operation: MigrationOperation,
  value: JsonRecord,
  dialect: SchemaDialect,
  features: DdlFeatures,
): string | undefined {
  if (features.dialect !== "postgresql") {
    throw new TypeError(`${features.dialect} does not support PostgreSQL extensions`)
  }

  const name = extensionName(value, requiredName(operation, value))
  let sql = `CREATE EXTENSION ${dialect.quoteIdentifier(name)}`
  const version = stringValue(value.extensionVersion)
  const schema = stringValue(value.schema)

  if (version !== undefined) {
    sql += ` VERSION ${schemaLiteral(dialect, version)}`
  }

  if (schema !== undefined) {
    sql += ` SCHEMA ${dialect.quoteIdentifier(schema)}`
  }

  return sql
}

function renderComment(
  operation: MigrationOperation,
  value: JsonRecord,
  dialect: SchemaDialect,
  features: DdlFeatures,
): string | undefined {
  const text = value.text === null ? null : stringValue(value.text)
  const target = recordValue(value.object)
  const targetKind = target === undefined ? undefined : stringValue(target.kind)
  const targetName =
    target === undefined ? undefined : (stringValue(target.id) ?? stringValue(target.physicalName))
  const name = stringValue(value.physicalName) ?? targetName

  if (features.dialect === "postgresql") {
    const type = commentTargetType(targetKind)

    if (type === undefined || name === undefined) {
      throw new TypeError("Comment target is incomplete")
    }

    return `COMMENT ON ${type} ${qualifiedName(operation, name, dialect)} IS ${text === null ? "NULL" : schemaLiteral(dialect, text)}`
  }

  if (features.dialect === "mysql") {
    if (name === undefined) {
      throw new TypeError("Comment target is incomplete")
    }

    if (targetKind === "column") {
      if (text === null) {
        throw new TypeError("MySQL column comments require a full column definition")
      }

      throw new TypeError("MySQL column comments require an explicit full ALTER TABLE definition")
    }

    return `ALTER TABLE ${qualifiedName(operation, name, dialect)} COMMENT = ${text === null ? schemaLiteral(dialect, "") : schemaLiteral(dialect, text)}`
  }

  throw new TypeError("SQLite does not support persistent object comments")
}

function renderOwnership(
  operation: MigrationOperation,
  value: JsonRecord,
  dialect: SchemaDialect,
  features: DdlFeatures,
): string | undefined {
  if (features.dialect !== "postgresql") {
    throw new TypeError(`${features.dialect} does not support object ownership DDL`)
  }

  const owner = stringValue(value.owner)
  const target = recordValue(value.object)
  const targetKind = target === undefined ? undefined : stringValue(target.kind)
  const targetName =
    target === undefined ? undefined : (stringValue(target.id) ?? stringValue(target.physicalName))
  const type = commentTargetType(targetKind)

  if (owner === undefined || targetName === undefined || type === undefined) {
    throw new TypeError("Ownership record is incomplete")
  }

  return `ALTER ${type} ${qualifiedName(operation, targetName, dialect)} OWNER TO ${dialect.quoteIdentifier(owner)}`
}

function renderAlterColumn(
  operation: MigrationOperation,
  value: JsonRecord,
  operations: readonly MigrationOperation[],
  dialect: SchemaDialect,
  features: DdlFeatures,
): string | undefined {
  const name = requiredName(operation, value)
  const table = parentTable(operation, operations, dialect)

  if (features.dialect === "sqlite") {
    throw new TypeError("SQLite cannot alter column definitions without rebuilding the table")
  }

  if (features.dialect === "mysql") {
    return `ALTER TABLE ${table} MODIFY COLUMN ${renderColumn(value, dialect, features)}`
  }

  const before = operation.origin?.before?.value

  if (!isRecord(before)) {
    throw new TypeError("Column property change is missing its prior value")
  }

  const statements: string[] = []

  if (!sameValue(before.storage, value.storage)) {
    statements.push(
      `ALTER TABLE ${table} ALTER COLUMN ${dialect.quoteIdentifier(name)} TYPE ${renderStorage(value.storage, dialect)}`,
    )
  }

  if (before.nullable !== value.nullable) {
    statements.push(
      `ALTER TABLE ${table} ALTER COLUMN ${dialect.quoteIdentifier(name)} ${value.nullable === false ? "SET NOT NULL" : "DROP NOT NULL"}`,
    )
  }

  if (!sameValue(before.default, value.default) || before.hasDefault !== value.hasDefault) {
    if (value.default === undefined) {
      statements.push(
        `ALTER TABLE ${table} ALTER COLUMN ${dialect.quoteIdentifier(name)} DROP DEFAULT`,
      )
    } else {
      statements.push(
        `ALTER TABLE ${table} ALTER COLUMN ${dialect.quoteIdentifier(name)} SET DEFAULT ${renderDefault(value.default, dialect)}`,
      )
    }
  }

  if (before.generatedColumn !== value.generatedColumn || before.identity !== value.identity) {
    throw new TypeError(
      "PostgreSQL generated and identity column changes require an explicit custom SQL operation",
    )
  }

  return statements.join(";\n")
}

function parentTable(
  operation: MigrationOperation,
  operations: readonly MigrationOperation[],
  dialect: SchemaDialect,
): string {
  const parent = operation.origin?.after?.parent ?? operation.origin?.before?.parent
  const candidate =
    parent === undefined
      ? undefined
      : operations.find(
          (item) =>
            item.kind === "table" &&
            item.logicalId === parent.id &&
            item.namespace === operation.namespace &&
            item.status !== "skipped",
        )
  const name = candidate?.physicalName ?? parent?.id

  if (name === undefined || name.length === 0) {
    throw new TypeError("Child operation is missing its parent table identity")
  }

  return qualifiedName(operation, name, dialect)
}

function tableReference(
  operation: MigrationOperation,
  reference: unknown,
  operations: readonly MigrationOperation[],
  dialect: SchemaDialect,
): string {
  const value = recordValue(reference)
  const id = value === undefined ? undefined : stringValue(value.id)
  const physicalName = value === undefined ? undefined : stringValue(value.physicalName)
  const candidate =
    id === undefined
      ? undefined
      : operations.find(
          (item) =>
            item.kind === "table" &&
            item.logicalId === id &&
            item.namespace === operation.namespace &&
            item.status !== "skipped",
        )
  const name = candidate?.physicalName ?? physicalName ?? id

  if (name === undefined || name.length === 0) {
    throw new TypeError("Referenced table identity is incomplete")
  }

  return qualifiedName(operation, name, dialect)
}

function qualifiedName(
  operation: MigrationOperation,
  name: string,
  dialect: SchemaDialect,
): string {
  const namespace = operation.namespace

  return namespace === undefined || namespace.length === 0
    ? dialect.quoteIdentifier(name)
    : `${dialect.quoteIdentifier(namespace)}.${dialect.quoteIdentifier(name)}`
}

function requiredName(operation: MigrationOperation, value: unknown): string {
  const name =
    operation.physicalName ??
    (isRecord(value) ? stringValue(value.physicalName) : undefined) ??
    (isRecord(value) ? stringValue(value.id) : undefined)

  if (name === undefined || name.length === 0) {
    throw new TypeError(`Operation "${operation.id}" is missing a physical name`)
  }

  return name
}

function requiredValueName(value: unknown): string {
  const name = isRecord(value)
    ? (stringValue(value.physicalName) ?? stringValue(value.id))
    : undefined

  if (name === undefined || name.length === 0) {
    throw new TypeError("Operation object is missing a physical name")
  }

  return name
}

function operationName(operation: MigrationOperation, value: unknown): string | undefined {
  if (operation.kind === "namespace" && isRecord(value)) {
    return stringValue(value.name)
  }

  if (!isRecord(value)) {
    return undefined
  }

  return operation.physicalName ?? stringValue(value.physicalName) ?? stringValue(value.id)
}

function requiresPhysicalName(kind: MigrationOperation["kind"]): boolean {
  return kind !== "custom-sql"
}

function isCoveredByParent(
  operation: MigrationOperation,
  operations: readonly MigrationOperation[],
): boolean {
  if (operation.type === "add" && operation.kind !== "column") {
    return false
  }

  if (operation.type !== "add" && operation.type !== "remove") {
    return false
  }

  const parent = operation.origin?.after?.parent ?? operation.origin?.before?.parent

  if (parent === undefined) {
    return false
  }

  const parentOperation = operations.find(
    (item) =>
      (item.kind === "table" || item.kind === "view" || item.kind === "materialized-view") &&
      item.logicalId === parent.id &&
      item.namespace === operation.namespace &&
      item.type === operation.type &&
      item.status !== "skipped",
  )

  return parentOperation !== undefined
}

function emission(
  ok: boolean,
  dialect: string,
  statements: readonly DdlStatement[],
  diagnostics: readonly DdlDiagnostic[],
): DdlEmission {
  const frozenStatements = Object.freeze(
    statements
      .slice()
      .sort(
        (left, right) =>
          left.position - right.position || left.operationId.localeCompare(right.operationId),
      )
      .map((statement) =>
        Object.freeze({
          ...statement,
          parameters: Object.freeze([...statement.parameters]),
        }),
      ),
  )
  const sql = frozenStatements
    .map((statement) =>
      statement.sql.trimEnd().endsWith(";") ? statement.sql.trimEnd() : `${statement.sql};`,
    )
    .join("\n")

  return Object.freeze({
    ok,
    dialect,
    statements: frozenStatements,
    diagnostics: Object.freeze(sortDiagnostics(diagnostics)),
    sql,
    parameters: Object.freeze(frozenStatements.flatMap((statement) => statement.parameters)),
  })
}

function operationDiagnostic(
  operation: MigrationOperation,
  code: DdlDiagnostic["code"],
  message: string,
): DdlDiagnostic {
  return {
    code,
    severity: "error",
    message,
    operationId: operation.id,
    path: operation.path,
    kind: operation.kind,
    dialect: operation.dialect.name,
  }
}

function mapPlanDiagnosticCode(code: string): DdlDiagnostic["code"] {
  if (code === "decision-required") {
    return "decision-required"
  }

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

  if (code === "custom-sql") {
    return "custom-sql"
  }

  if (code === "non-canonical") {
    return "non-canonical"
  }

  return "invalid-plan"
}

function sortDiagnostics(diagnostics: readonly DdlDiagnostic[]): readonly DdlDiagnostic[] {
  return [...diagnostics].sort(
    (left, right) =>
      comparePath(left.path, right.path) ||
      (left.operationId ?? "").localeCompare(right.operationId ?? "") ||
      left.code.localeCompare(right.code) ||
      left.message.localeCompare(right.message),
  )
}

function comparePath(
  left: readonly (string | number)[],
  right: readonly (string | number)[],
): number {
  const length = Math.min(left.length, right.length)

  for (let index = 0; index < length; index += 1) {
    const a = String(left[index])
    const b = String(right[index])
    const compared = a.localeCompare(b)

    if (compared !== 0) {
      return compared
    }
  }

  return left.length - right.length
}

function normalizeSql(sql: string): string {
  return sql.replace(/\r\n?/gu, "\n")
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function recordValue(value: unknown): JsonRecord | undefined {
  return isRecord(value) ? value : undefined
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isPath(value: unknown): value is readonly (string | number)[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string" || typeof item === "number")
  )
}

function arrayOfRecords(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord).map((item) => ({ ...item })) : []
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : []
}

function expressionValue(value: unknown): SnapshotExpression | undefined {
  if (
    !isRecord(value) ||
    value.kind !== "expression" ||
    typeof value.sql !== "string" ||
    typeof value.expressionKind !== "string"
  ) {
    return undefined
  }

  return value as unknown as SnapshotExpression
}

function expressionsIn(value: JsonRecord): readonly SnapshotExpression[] {
  const result: SnapshotExpression[] = []
  const visit = (current: unknown): void => {
    const expression = expressionValue(current)

    if (expression !== undefined) {
      result.push(expression)
      return
    }

    if (Array.isArray(current)) {
      for (const item of current) {
        visit(item)
      }

      return
    }

    if (isRecord(current)) {
      for (const child of Object.values(current)) {
        visit(child)
      }
    }
  }

  visit(value)
  return result
}

function storageDialect(value: unknown): string | undefined {
  const storage = recordValue(value)

  return storage?.kind === "native" ? stringValue(storage.dialect) : undefined
}

function renderValueFact(value: JsonRecord, dialect: SchemaDialect): string {
  if (value.kind === "literal") {
    return renderLiteral(value.value, dialect)
  }

  if (value.kind === "expression") {
    return renderDefault(value, dialect)
  }

  throw new TypeError("Value fact must be a literal or expression")
}

function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length && left.every((item, index) => sameValue(item, right[index]))
    )
  }

  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left).sort()
    const rightKeys = Object.keys(right).sort()

    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every((key, index) => key === rightKeys[index] && sameValue(left[key], right[key]))
    )
  }

  return false
}

function sqlAction(action: string): string {
  return action.replaceAll("-", " ").toUpperCase()
}

function extensionName(value: JsonRecord, fallback: string): string {
  return stringValue(value.extensionName) ?? fallback
}

function commentTargetType(kind: string | undefined): string | undefined {
  switch (kind) {
    case "table": {
      return "TABLE"
    }

    case "view": {
      return "VIEW"
    }

    case "materialized-view": {
      return "MATERIALIZED VIEW"
    }

    case "sequence": {
      return "SEQUENCE"
    }

    case "function":
    case "routine": {
      return "FUNCTION"
    }

    case "column": {
      return "COLUMN"
    }

    case "schema":
    case "namespace": {
      return "SCHEMA"
    }

    case "index": {
      return "INDEX"
    }

    default: {
      return undefined
    }
  }
}

function dollarQuote(sql: string): string {
  const tags = ["$$", "$qubu$", "$qubu_ddl$"]

  for (const tag of tags) {
    if (!sql.includes(tag)) {
      return `${tag}${sql}${tag}`
    }
  }

  return `'${sql.replaceAll("'", "''")}'`
}

function parseVersion(value: string | number): readonly number[] | undefined {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) {
      return undefined
    }

    value = String(value)
  }

  const match = value.trim().match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/iu)

  if (match === null) {
    return undefined
  }

  return match
    .slice(1)
    .filter((item) => item !== undefined)
    .map((item) => Number(item))
}

function compareVersion(left: readonly number[], right: readonly number[]): number {
  const length = Math.max(left.length, right.length)

  for (let index = 0; index < length; index += 1) {
    const comparison = (left[index] ?? 0) - (right[index] ?? 0)

    if (comparison !== 0) {
      return comparison
    }
  }

  return 0
}
