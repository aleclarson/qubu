import { postgresDialect } from "../dialects/postgres.ts"
import type { AnyExpression, AnySchemaExpression } from "../expressions/types.ts"
import type { ColumnStorage, PortableStorageType } from "../schema/column.ts"
import { validateConstraintDialect, type SourceConstraint } from "../schema/constraints.ts"
import { createSchemaDialect, type SchemaDialect } from "../schema/dialect.ts"
import { isUnsafeSchemaSql, renderSchemaExpression } from "../schema/expressions.ts"
import { validateIndexDialect, type SourceIndex } from "../schema/indexes.ts"
import { isValidSchemaObjectName, type SchemaMetadataDiagnostic } from "../schema/metadata.ts"
import type { SchemaDialectExtension } from "../schema/metadata.ts"
import type { Schema, SchemaTableEntry } from "../schema/registry.ts"
import type { AnyTable, TableDefinitions } from "../schema/table.ts"
import { toSnapshotJsonValue } from "./canonical.ts"
import {
  createSchemaSnapshot,
  tryCreateSchemaSnapshot,
  type SchemaSnapshotOptions,
} from "./serialize.ts"
import {
  schemaSnapshotDialectVersion,
  type SchemaSnapshot,
  type SchemaSnapshotAdapter,
  type SnapshotCreateResult,
  type SnapshotDiagnostic,
  type SnapshotDialect,
  type SnapshotExpression,
  type SnapshotStorage,
  type SnapshotStorageContext,
  type SnapshotExpressionContext,
  type SnapshotExtensionContext,
  type SnapshotValidationContext,
  type SnapshotJsonValue,
} from "./types.ts"

/** PostgreSQL's v1 snapshot extension identity. */
export const postgresSnapshotDialect: SnapshotDialect = Object.freeze({
  name: "postgresql",
  version: schemaSnapshotDialectVersion,
})

class PostgresSnapshotDialectError extends TypeError {
  readonly code = "dialect-mismatch" as const
}

const postgresStorageTypes: Readonly<Record<PortableStorageType, string>> = Object.freeze({
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
})

/** PostgreSQL's query dialect plus its schema metadata behavior. */
export const postgresSchemaDialect: SchemaDialect<
  "ilike" | "json" | "on-conflict" | "row-locking"
> = createSchemaDialect(postgresDialect(), {
  version: schemaSnapshotDialectVersion,
  validate: validatePostgresSchema,
  encodeStorage(storage: ColumnStorage, context: SnapshotStorageContext) {
    return encodePostgresStorage(storage, context.dialect)
  },
  encodeExpression(expression: AnyExpression, context: SnapshotExpressionContext) {
    return encodePostgresExpression(expression, context.mode, context.dialect)
  },
  encodeDialectExtension(extension: SchemaDialectExtension, context: SnapshotExtensionContext) {
    return encodePostgresExtension(extension, context.dialect)
  },
})

/** Snapshot adapter retaining the historical adapter-shaped entry point. */
export const postgresSnapshotAdapter: SchemaSnapshotAdapter<
  "ilike" | "json" | "on-conflict" | "row-locking"
> = Object.freeze({
  dialect: postgresSchemaDialect,
})

/** Create a canonical PostgreSQL schema snapshot. */
export function createPostgresSchemaSnapshot<TSchema extends Schema<any>>(
  schema: TSchema,
  options: PostgresSnapshotOptions = {},
): SchemaSnapshot {
  return createSchemaSnapshot(schema, {
    ...options,
    adapter: postgresSnapshotAdapter,
  })
}

/** Return PostgreSQL capability diagnostics without throwing. */
export function tryCreatePostgresSchemaSnapshot<TSchema extends Schema<any>>(
  schema: TSchema,
  options: PostgresSnapshotOptions = {},
): SnapshotCreateResult {
  return tryCreateSchemaSnapshot(schema, {
    ...options,
    adapter: postgresSnapshotAdapter,
  })
}

/** Options accepted by the PostgreSQL snapshot convenience functions. */
export type PostgresSnapshotOptions = Omit<SchemaSnapshotOptions, "adapter" | "dialect">

function encodePostgresStorage(storage: ColumnStorage, dialect: SchemaDialect): SnapshotStorage {
  if (storage.kind === "native") {
    if (storage.dialect !== dialect.name) {
      throw new TypeError(
        `PostgreSQL storage cannot encode a native declaration owned by "${storage.dialect}"`,
      )
    }

    if (storage.type.trim().length === 0) {
      throw new TypeError("PostgreSQL native storage declarations cannot be empty")
    }

    return {
      kind: "native",
      dialect: dialect.name,
      type: storage.type,
    }
  }

  const type = postgresStorageTypes[storage.type]

  if (type === undefined) {
    throw new TypeError(`Unsupported portable storage type for PostgreSQL: ${String(storage.type)}`)
  }

  return {
    kind: "native",
    dialect: dialect.name,
    type,
  }
}

function encodePostgresExpression(
  expression: AnyExpression,
  mode: "default" | "generated" | "check" | "index",
  dialect: SchemaDialect,
): SnapshotExpression {
  if (isUnsafeSchemaSql(expression) && expression.schemaSqlDialect !== dialect.name) {
    throw new PostgresSnapshotDialectError(
      `Schema SQL is tagged for "${expression.schemaSqlDialect}" but the PostgreSQL schema dialect is "${dialect.name}"`,
    )
  }

  const rendered = renderSchemaExpression(expression as AnySchemaExpression, {
    mode,
    dialect,
  })

  if (rendered.parameters.length !== 0) {
    throw new TypeError("PostgreSQL schema expressions must be parameter-free")
  }

  return {
    kind: "expression",
    expressionKind: expression.expressionKind,
    sql: rendered.text,
    ...(isUnsafeSchemaSql(expression) ? { dialect: dialect.name } : {}),
  }
}

function encodePostgresExtension(
  extension: { readonly dialect: string },
  dialect: SchemaDialect,
): {
  readonly dialect: string
  readonly version: number
  readonly data: SnapshotJsonValue
} {
  if (extension.dialect !== dialect.name) {
    throw new TypeError(`PostgreSQL schema extensions require dialect "${dialect.name}"`)
  }

  const data = Object.fromEntries(
    Object.entries(extension)
      .filter(([key]) => key !== "dialect")
      .sort(([left], [right]) => left.localeCompare(right)),
  )

  return {
    dialect: dialect.name,
    version: dialect.schema.version,
    data: sortSnapshotJson(toSnapshotJsonValue(data)),
  }
}

function sortSnapshotJson(value: SnapshotJsonValue): SnapshotJsonValue {
  if (Array.isArray(value)) {
    return value.map(sortSnapshotJson)
  }

  if (typeof value !== "object" || value === null) {
    return value
  }

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortSnapshotJson(child)]),
  )
}

function validatePostgresSchema(
  schema: Schema<any>,
  context: SnapshotValidationContext,
): readonly SnapshotDiagnostic[] {
  const diagnostics: SnapshotDiagnostic[] = []
  const tableEntries = Object.entries(schema.registry).sort(([left], [right]) =>
    compareIds(left, right),
  )
  const relationNames = new Map<string, readonly (string | number)[]>()

  if (schema.namespace !== undefined) {
    validatePostgresName(schema.namespace, ["namespace"], "PostgreSQL namespace", diagnostics)
  }

  for (const [id, entry] of tableEntries) {
    const tablePath = ["tables", id] as const

    validatePostgresName(
      entry.physicalName,
      [...tablePath, "physicalName"],
      "PostgreSQL table",
      diagnostics,
    )
    addRelationName(
      relationNames,
      entry.physicalName,
      [...tablePath, "physicalName"],
      "table",
      diagnostics,
    )
  }

  for (const [id, entry] of tableEntries) {
    validatePostgresTable(id, entry, context, relationNames, diagnostics)
  }

  return Object.freeze(diagnostics)
}

function validatePostgresTable(
  tableId: string,
  entry: SchemaTableEntry,
  context: SnapshotValidationContext,
  relationNames: Map<string, readonly (string | number)[]>,
  diagnostics: SnapshotDiagnostic[],
): void {
  const table = entry.table as AnyTable
  const tablePath = ["tables", tableId] as const
  const definitions = table.definitions as TableDefinitions

  for (const [columnId, definition] of Object.entries(definitions).sort(([left], [right]) =>
    compareIds(left, right),
  )) {
    validatePostgresName(
      table.sqlNames[columnId] ?? columnId,
      [...tablePath, "columns", columnId, "physicalName"],
      "PostgreSQL column",
      diagnostics,
    )
    if (definition.onUpdate !== undefined) {
      diagnostics.push({
        code: "unsupported-dialect-option",
        message: "MySQL ON UPDATE expressions are not supported by PostgreSQL",
        path: [...tablePath, "columns", columnId, "onUpdate"],
      })
    }

    const generated = definition.generatedColumn

    if (
      generated !== undefined &&
      generated.kind === "expression" &&
      generated.mode === "virtual"
    ) {
      diagnostics.push({
        code: "unsupported-dialect-option",
        message:
          "PostgreSQL v1 snapshots support stored generated columns only; virtual generated columns are not supported",
        path: [...tablePath, "columns", columnId, "generatedColumn", "mode"],
      })
    }
  }

  const metadata = table as AnyTable & {
    readonly constraints: Readonly<Record<string, SourceConstraint>>
    readonly indexes: Readonly<Record<string, SourceIndex & { readonly physicalName?: string }>>
  }
  const constraintNames = new Map<string, readonly (string | number)[]>()

  const constraints = Object.entries(metadata.constraints) as Array<[string, SourceConstraint]>

  for (const [constraintId, constraint] of constraints.sort(([left], [right]) =>
    compareIds(left, right),
  )) {
    const constraintPath = [...tablePath, "constraints", constraintId] as const
    const physicalName = constraint.physicalName ?? constraintId

    validatePostgresName(
      physicalName,
      [...constraintPath, "physicalName"],
      "PostgreSQL constraint",
      diagnostics,
    )
    addScopedName(
      constraintNames,
      physicalName,
      [...constraintPath, "physicalName"],
      "constraint",
      diagnostics,
    )
    appendMetadataDiagnostics(
      diagnostics,
      validateConstraintDialect(constraint, context.dialect.name, constraintPath),
    )

    if (constraint.kind === "check" && constraint.deferrable === true) {
      diagnostics.push({
        code: "unsupported-dialect-option",
        message: "PostgreSQL CHECK constraints cannot be DEFERRABLE",
        path: [...constraintPath, "deferrable"],
      })
    }

    if (constraint.kind === "foreign-key" && constraint.match === "partial") {
      diagnostics.push({
        code: "unsupported-dialect-option",
        message: "PostgreSQL does not implement MATCH PARTIAL foreign keys",
        path: [...constraintPath, "match"],
      })
    }

    if (constraint.kind === "unique-constraint" && constraint.nulls === "not-distinct") {
      diagnostics.push({
        code: "unsupported-dialect-option",
        message:
          "PostgreSQL NULLS NOT DISTINCT requires a server-version policy; the v1 adapter does not assume PostgreSQL 15 or newer",
        path: [...constraintPath, "nulls"],
      })
    }
  }

  const indexes = Object.entries(metadata.indexes) as Array<
    [string, SourceIndex & { readonly physicalName?: string }]
  >

  for (const [indexId, index] of indexes.sort(([left], [right]) => compareIds(left, right))) {
    const indexPath = [...tablePath, "indexes", indexId] as const
    const physicalName = index.physicalName ?? indexId

    validatePostgresName(
      physicalName,
      [...indexPath, "physicalName"],
      "PostgreSQL index",
      diagnostics,
    )
    addRelationName(
      relationNames,
      physicalName,
      [...indexPath, "physicalName"],
      "index",
      diagnostics,
    )
    appendMetadataDiagnostics(
      diagnostics,
      validateIndexDialect(index, context.dialect.name, indexPath),
    )
  }
}

function validatePostgresName(
  name: string,
  path: readonly (string | number)[],
  kind: string,
  diagnostics: SnapshotDiagnostic[],
): void {
  if (!isValidSchemaObjectName(name) || name.length === 0) {
    diagnostics.push({
      code: "invalid-schema",
      message: `${kind} name "${name}" is not a valid unqualified identifier`,
      path,
    })
  }

  if (new TextEncoder().encode(name).length > 63) {
    diagnostics.push({
      code: "unsupported-dialect-option",
      message: `${kind} name exceeds PostgreSQL's 63-byte identifier limit`,
      path,
    })
  }
}

function addRelationName(
  names: Map<string, readonly (string | number)[]>,
  name: string,
  path: readonly (string | number)[],
  kind: string,
  diagnostics: SnapshotDiagnostic[],
): void {
  addScopedName(names, name, path, kind, diagnostics)
}

function addScopedName(
  names: Map<string, readonly (string | number)[]>,
  name: string,
  path: readonly (string | number)[],
  kind: string,
  diagnostics: SnapshotDiagnostic[],
): void {
  const previousPath = names.get(name)

  if (previousPath !== undefined) {
    diagnostics.push({
      code: "invalid-schema",
      message: `PostgreSQL ${kind} name "${name}" collides with another relation or metadata object`,
      path,
      relatedPaths: [previousPath],
    })
    return
  }

  names.set(name, path)
}

function appendMetadataDiagnostics(
  diagnostics: SnapshotDiagnostic[],
  issues: readonly SchemaMetadataDiagnostic[],
): void {
  for (const issue of issues) {
    if (issue.code === "dialect-mismatch") {
      continue
    }

    diagnostics.push({
      code:
        issue.code === "unsupported-dialect-option"
          ? "unsupported-dialect-option"
          : "invalid-schema",
      message: issue.message,
      path: issue.path,
      ...(issue.relatedPaths === undefined ? {} : { relatedPaths: issue.relatedPaths }),
    })
  }
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
