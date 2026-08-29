import { getTableColumns, sql, type Column, type SQL, type Table } from "drizzle-orm"
import type {
  AnyTable,
  PortableColumnStorage,
  Schema,
  SchemaTableRecord,
  TableDefinitions,
} from "qubu"
import type {
  SchemaSnapshot,
  SnapshotColumn,
  SnapshotConstraint,
  SnapshotDialectExtension,
  SnapshotIndex,
  SnapshotIndexTerm,
  SnapshotIndexTermExpression,
  SnapshotJsonValue,
  SnapshotLiteral,
  SnapshotTable,
} from "qubu/snapshot"

import { DrizzleSchemaConversionError } from "./errors.ts"
import type { DrizzleDialect } from "./types.ts"

export type RuntimeColumnBuilder = {
  notNull(): RuntimeColumnBuilder
  default(value: unknown): RuntimeColumnBuilder
  $defaultFn(callback: () => unknown): RuntimeColumnBuilder
  generatedAlwaysAs(
    value: SQL,
    config?: { readonly mode?: "stored" | "virtual" },
  ): RuntimeColumnBuilder
  $onUpdateFn(callback: () => SQL): RuntimeColumnBuilder
  primaryKey?(config?: { readonly autoIncrement?: boolean }): RuntimeColumnBuilder
  autoincrement?(): RuntimeColumnBuilder
  generatedAlwaysAsIdentity?(): RuntimeColumnBuilder
  generatedByDefaultAsIdentity?(): RuntimeColumnBuilder
}

export type RuntimeColumnRecord = Record<string, Column>
type RuntimeTableRecord = Record<string, Table>

export type RuntimeTableFactory = (
  name: string,
  columns: Record<string, RuntimeColumnBuilder>,
  extraConfig: (columns: RuntimeColumnRecord) => readonly unknown[],
) => Table

export type RuntimeForeignKeyBuilder = {
  onUpdate(action: RuntimeReferentialAction): RuntimeForeignKeyBuilder
  onDelete(action: RuntimeReferentialAction): RuntimeForeignKeyBuilder
}

export type RuntimeIndexBuilder = {
  concurrently(): RuntimeIndexBuilder
  with(values: Record<string, unknown>): RuntimeIndexBuilder
  where(condition: SQL): RuntimeIndexBuilder
  using(value: string): RuntimeIndexBuilder
  algorithm(value: string): RuntimeIndexBuilder
  lock(value: string): RuntimeIndexBuilder
}

type RuntimeReferentialAction = "cascade" | "restrict" | "no action" | "set null" | "set default"

export type RuntimeQubuColumnDefinition = TableDefinitions[string]
export type RuntimeIndexTerm = Column | SQL

export type DrizzleRuntimeAdapter = {
  readonly dialect: DrizzleDialect
  createSnapshot(schema: Schema<SchemaTableRecord>): SchemaSnapshot
  createTableFactory(namespace: string | undefined): RuntimeTableFactory
  createStorageBuilder(
    type: PortableColumnStorage["type"] | undefined,
    name: string,
    declaration: string,
    definition: RuntimeQubuColumnDefinition,
  ): RuntimeColumnBuilder
  applyIdentity(
    builder: RuntimeColumnBuilder,
    definition: RuntimeQubuColumnDefinition,
    column: SnapshotColumn,
    table: SnapshotTable,
  ): RuntimeColumnBuilder
  createPrimaryKey(name: string, columns: readonly Column[]): unknown
  createUniqueConstraint(
    name: string,
    columns: readonly Column[],
    nullsNotDistinct: boolean,
  ): unknown
  createCheck(name: string, expression: SQL): unknown
  createForeignKey(
    name: string,
    columns: readonly Column[],
    foreignColumns: readonly Column[],
  ): RuntimeForeignKeyBuilder
  createIndex(
    index: SnapshotIndex,
    terms: readonly RuntimeIndexTerm[],
    predicate: SQL | undefined,
  ): unknown
}

/** Build Drizzle tables using one dialect adapter supplied by a leaf entrypoint. */
export function convertDrizzleSchema(
  schema: Schema<SchemaTableRecord>,
  adapter: DrizzleRuntimeAdapter,
): Readonly<Record<string, Table>> {
  const snapshot = adapter.createSnapshot(schema)

  assertRepresentableMetadata(snapshot, adapter.dialect)

  const tables: RuntimeTableRecord = {}
  const tableFactory = adapter.createTableFactory(schema.namespace)
  const snapshotTables = new Map(snapshot.tables.map((table) => [table.id, table] as const))

  for (const [tableId, entry] of Object.entries(schema.registry)) {
    const snapshotTable = snapshotTables.get(tableId)

    if (snapshotTable === undefined) {
      continue
    }

    const columns = createColumns(entry.table, snapshotTable, adapter)

    tables[snapshotTable.id] = tableFactory(snapshotTable.physicalName, columns, (drizzleColumns) =>
      createExtraConfig(snapshotTable, drizzleColumns, tables, adapter),
    )
  }

  return Object.freeze({ ...tables })
}

function createColumns(
  table: AnyTable,
  snapshotTable: SnapshotTable,
  adapter: DrizzleRuntimeAdapter,
): Record<string, RuntimeColumnBuilder> {
  const definitions = table.definitions as TableDefinitions
  const snapshotColumns = new Map(
    snapshotTable.columns.map((column) => [column.id, column] as const),
  )

  return Object.fromEntries(
    Object.entries(definitions).map(([columnId, definition]) => {
      const snapshotColumn = snapshotColumns.get(columnId)

      if (snapshotColumn === undefined) {
        throw new DrizzleSchemaConversionError(
          "missing-storage",
          `Qubu column "${snapshotTable.id}.${columnId}" has no snapshot definition`,
          ["tables", snapshotTable.id, "columns", columnId],
        )
      }

      return [
        snapshotColumn.id,
        createColumnBuilder(definition, snapshotColumn, snapshotTable, adapter),
      ]
    }),
  )
}

function createColumnBuilder(
  definition: RuntimeQubuColumnDefinition,
  column: SnapshotColumn,
  table: SnapshotTable,
  adapter: DrizzleRuntimeAdapter,
): RuntimeColumnBuilder {
  const declaration = column.storage?.type

  if (declaration === undefined) {
    throw new DrizzleSchemaConversionError(
      "missing-storage",
      `Qubu column "${table.id}.${column.id}" needs physical storage before it can become a Drizzle column`,
      ["tables", table.id, "columns", column.id, "storage"],
    )
  }

  const portableType = definition.storage?.kind === "portable" ? definition.storage.type : undefined
  let builder = adapter.createStorageBuilder(
    portableType,
    column.physicalName,
    declaration,
    definition,
  )

  if (!column.nullable) {
    builder = builder.notNull()
  }

  if (definition.defaultFn !== undefined) {
    builder = builder.$defaultFn(definition.defaultFn)
  }

  if (column.default?.kind === "literal") {
    builder = builder.default(decodeSnapshotLiteral(column.default.value))
  } else if (column.default?.kind === "expression") {
    builder = builder.default(sql.raw(column.default.expression.sql))
  }

  if (column.generatedColumn?.kind === "expression") {
    builder = builder.generatedAlwaysAs(sql.raw(column.generatedColumn.expression.sql), {
      mode: column.generatedColumn.mode,
    })
  }

  if (column.onUpdate !== undefined) {
    builder = builder.$onUpdateFn(() => sql.raw(column.onUpdate?.sql ?? ""))
  }

  if (column.identity !== undefined) {
    builder = adapter.applyIdentity(builder, definition, column, table)
  }

  return builder
}

function decodeSnapshotLiteral(value: SnapshotLiteral): unknown {
  switch (value.kind) {
    case "null": {
      return null
    }

    case "boolean":
    case "string": {
      return value.value
    }

    case "number": {
      return Number(value.value)
    }

    case "bigint": {
      return BigInt(value.value)
    }
  }
}

function createExtraConfig(
  table: SnapshotTable,
  columns: RuntimeColumnRecord,
  tables: RuntimeTableRecord,
  adapter: DrizzleRuntimeAdapter,
): readonly unknown[] {
  return [
    ...table.constraints.flatMap((constraint) =>
      createConstraint(constraint, columns, tables, adapter),
    ),
    ...table.indexes.map((index) => createIndex(index, columns, adapter)),
  ]
}

function createConstraint(
  constraint: SnapshotConstraint,
  columns: RuntimeColumnRecord,
  tables: RuntimeTableRecord,
  adapter: DrizzleRuntimeAdapter,
): readonly unknown[] {
  const localColumns =
    constraint.kind === "check" ? [] : constraint.columns.map((column) => columns[column])

  if (constraint.kind !== "check" && localColumns.some((value) => !value)) {
    throw unsupportedMetadata(
      `Drizzle could not resolve every column in constraint "${constraint.id}"`,
      ["constraints", constraint.id, "columns"],
    )
  }

  if (constraint.kind === "primary-key") {
    if (
      adapter.dialect === "sqlite" &&
      localColumns.length === 1 &&
      (localColumns[0] as (Column & { primary?: boolean }) | undefined)?.primary === true
    ) {
      return []
    }

    return [adapter.createPrimaryKey(constraint.physicalName, localColumns)]
  }

  if (constraint.kind === "unique" || constraint.kind === "unique-constraint") {
    return [
      adapter.createUniqueConstraint(
        constraint.physicalName,
        localColumns,
        constraint.kind === "unique-constraint" && constraint.nulls === "not-distinct",
      ),
    ]
  }

  if (constraint.kind === "check") {
    return [adapter.createCheck(constraint.physicalName, sql.raw(constraint.expression.sql))]
  }

  if (constraint.kind !== "foreign-key") {
    throw unsupportedMetadata(`Drizzle cannot represent constraint kind "${constraint.kind}"`, [
      "constraints",
      constraint.id,
      "kind",
    ])
  }

  const foreignTable = tables[constraint.target.table]
  const foreignColumns = foreignTable
    ? constraint.target.columns.map((column) => getTableColumns(foreignTable)[column])
    : []

  if (
    foreignColumns.length !== constraint.target.columns.length ||
    foreignColumns.some((value) => !value)
  ) {
    throw unsupportedMetadata(
      `Drizzle could not resolve the target of foreign key "${constraint.id}"`,
      ["constraints", constraint.id, "target"],
    )
  }

  let builder = adapter.createForeignKey(constraint.physicalName, localColumns, foreignColumns)

  if (constraint.onUpdate) {
    builder = builder.onUpdate(toDrizzleAction(constraint.onUpdate))
  }

  if (constraint.onDelete) {
    builder = builder.onDelete(toDrizzleAction(constraint.onDelete))
  }

  return [builder]
}

function createIndex(
  index: SnapshotIndex,
  columns: RuntimeColumnRecord,
  adapter: DrizzleRuntimeAdapter,
): unknown {
  const terms = index.terms.map((term) => createIndexTerm(term, columns))
  const predicate = index.predicate ? sql.raw(index.predicate.sql) : undefined

  return adapter.createIndex(index, terms, predicate)
}

function createIndexTerm(term: SnapshotIndexTerm, columns: RuntimeColumnRecord): RuntimeIndexTerm {
  if (term.kind !== "order") {
    return createIndexTermExpression(term, columns)
  }

  const expression = createIndexTermExpression(term.expression, columns)
  const suffix = [term.direction, term.nulls && `NULLS ${term.nulls}`]
    .filter((value): value is string => value !== undefined)
    .join(" ")

  return suffix.length === 0 ? expression : sql`${expression} ${sql.raw(suffix)}`
}

function createIndexTermExpression(
  term: SnapshotIndexTermExpression,
  columns: RuntimeColumnRecord,
): RuntimeIndexTerm {
  if (term.kind === "expression") {
    return sql.raw(term.expression.sql)
  }

  const column = columns[term.column]

  if (column === undefined) {
    throw unsupportedMetadata(`Drizzle could not resolve index column "${term.column}"`, [
      "indexes",
      "terms",
      term.column,
    ])
  }

  return column
}

function toDrizzleAction(action: string): RuntimeReferentialAction {
  return action.replace("-", " ") as RuntimeReferentialAction
}

function assertRepresentableMetadata(snapshot: SchemaSnapshot, dialect: DrizzleDialect): void {
  for (const table of snapshot.tables) {
    for (const constraint of table.constraints) {
      const path = ["tables", table.id, "constraints", constraint.id] as const

      if (constraint.deferrable === true || constraint.initially !== undefined) {
        throw unsupportedMetadata(
          `Drizzle cannot represent deferred constraint "${constraint.id}"`,
          path,
        )
      }

      if (
        constraint.kind === "foreign-key" &&
        constraint.match !== undefined &&
        constraint.match !== "simple"
      ) {
        throw unsupportedMetadata(
          `Drizzle cannot represent MATCH ${constraint.match.toUpperCase()} on foreign key "${constraint.id}"`,
          [...path, "match"],
        )
      }

      assertConstraintExtension(constraint.dialect, dialect, path)
    }

    for (const index of table.indexes) {
      const path = ["tables", table.id, "indexes", index.id] as const

      if (index.includedColumns && index.includedColumns.length > 0) {
        throw unsupportedMetadata(`Drizzle ${dialect} indexes cannot represent included columns`, [
          ...path,
          "includedColumns",
        ])
      }

      assertIndexExtension(index.dialect, dialect, path)
    }
  }
}

function assertConstraintExtension(
  extension: SnapshotDialectExtension | undefined,
  dialect: DrizzleDialect,
  path: readonly (string | number)[],
): void {
  const data = extensionData(extension)
  const unsupported = Object.entries(data).find(([key, value]) => {
    if (value === undefined) {
      return false
    }

    if (dialect === "postgresql" && key === "notValid") {
      return value === true
    }

    if (dialect === "mysql" && key === "enforced") {
      return value === false
    }

    if (dialect === "sqlite" && key === "onConflict") {
      return true
    }

    if (value === false) {
      return false
    }

    return true
  })

  if (unsupported) {
    throw unsupportedMetadata(`Drizzle cannot represent constraint option "${unsupported[0]}"`, [
      ...path,
      "dialect",
      unsupported[0],
    ])
  }
}

function assertIndexExtension(
  extension: SnapshotDialectExtension | undefined,
  dialect: DrizzleDialect,
  path: readonly (string | number)[],
): void {
  const data = extensionData(extension)
  const supported =
    dialect === "postgresql"
      ? new Set(["method", "concurrently", "storageParameters"])
      : dialect === "mysql"
        ? new Set(["using", "algorithm", "lock"])
        : new Set<string>()

  const unsupported = Object.entries(data).find(
    ([key, value]) => value !== undefined && value !== false && !supported.has(key),
  )

  if (unsupported) {
    throw unsupportedMetadata(`Drizzle cannot represent index option "${unsupported[0]}"`, [
      ...path,
      "dialect",
      unsupported[0],
    ])
  }
}

export function extensionData(
  extension: SnapshotDialectExtension | undefined,
): Readonly<Record<string, SnapshotJsonValue | undefined>> {
  const data = extension?.data

  return data !== null && typeof data === "object" && !Array.isArray(data)
    ? (data as Readonly<Record<string, SnapshotJsonValue | undefined>>)
    : {}
}

export function stringExtension(
  data: Readonly<Record<string, SnapshotJsonValue | undefined>>,
  key: string,
): string | undefined {
  const value = data[key]

  return typeof value === "string" ? value : undefined
}

export function recordExtension(
  data: Readonly<Record<string, SnapshotJsonValue | undefined>>,
  key: string,
): Record<string, unknown> | undefined {
  const value = data[key]

  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function unsupportedMetadata(
  message: string,
  path: readonly (string | number)[],
): DrizzleSchemaConversionError {
  return new DrizzleSchemaConversionError("unsupported-metadata", message, path)
}
