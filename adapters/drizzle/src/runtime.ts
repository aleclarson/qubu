import * as drizzle from "drizzle-orm"
import type * as qubu from "qubu"
import type * as snapshot from "qubu/snapshot"

import { DrizzleSchemaConversionError } from "./errors.ts"
import type { DrizzleDialect } from "./types.ts"

export type ColumnBuilder = {
  notNull(): ColumnBuilder
  default(value: unknown): ColumnBuilder
  $defaultFn(callback: () => unknown): ColumnBuilder
  generatedAlwaysAs(
    value: drizzle.SQL,
    config?: { readonly mode?: "stored" | "virtual" },
  ): ColumnBuilder
  onUpdateNow?(config?: { readonly fsp?: number }): ColumnBuilder
  primaryKey?(config?: { readonly autoIncrement?: boolean }): ColumnBuilder
  autoincrement?(): ColumnBuilder
  generatedAlwaysAsIdentity?(): ColumnBuilder
  generatedByDefaultAsIdentity?(): ColumnBuilder
}

export type ColumnRecord = Record<string, drizzle.Column>
type TableRecord = Record<string, drizzle.Table>

export type TableFactory = (
  name: string,
  columns: Record<string, ColumnBuilder>,
  extraConfig: (columns: ColumnRecord) => readonly unknown[],
) => drizzle.Table

export type ForeignKeyBuilder = {
  onUpdate(action: ReferentialAction): ForeignKeyBuilder
  onDelete(action: ReferentialAction): ForeignKeyBuilder
}

export type IndexBuilder = {
  concurrently(): IndexBuilder
  with(values: Record<string, unknown>): IndexBuilder
  where(condition: drizzle.SQL): IndexBuilder
  using(value: string): IndexBuilder
  algorithm(value: string): IndexBuilder
  lock(value: string): IndexBuilder
}

type ReferentialAction = "cascade" | "restrict" | "no action" | "set null" | "set default"

export type ColumnDefinition = qubu.TableDefinitions[string]
export type IndexTerm = drizzle.Column | drizzle.SQL

export type DialectAdapter = {
  readonly dialect: DrizzleDialect
  createSnapshot(schema: qubu.Schema<qubu.SchemaTableRecord>): snapshot.SchemaSnapshot
  createTableFactory(namespace: string | undefined): TableFactory
  createStorageBuilder(
    type: qubu.PortableColumnStorage["type"] | undefined,
    name: string,
    declaration: string,
    definition: ColumnDefinition,
  ): ColumnBuilder
  applyIdentity(
    builder: ColumnBuilder,
    definition: ColumnDefinition,
    column: snapshot.SnapshotColumn,
    table: snapshot.SnapshotTable,
  ): ColumnBuilder
  applyOnUpdate?(
    builder: ColumnBuilder,
    column: snapshot.SnapshotColumn,
    table: snapshot.SnapshotTable,
  ): ColumnBuilder
  createPrimaryKey(name: string, columns: readonly drizzle.Column[]): unknown
  createUniqueConstraint(
    name: string,
    columns: readonly drizzle.Column[],
    nullsNotDistinct: boolean,
  ): unknown
  createCheck(name: string, expression: drizzle.SQL): unknown
  createForeignKey(
    name: string,
    columns: readonly drizzle.Column[],
    foreignColumns: readonly drizzle.Column[],
  ): ForeignKeyBuilder
  createIndex(
    index: snapshot.SnapshotIndex,
    terms: readonly IndexTerm[],
    predicate: drizzle.SQL | undefined,
  ): unknown
}

/** Build Drizzle tables using one dialect adapter supplied by a leaf entrypoint. */
export function convertDrizzleSchema(
  schema: qubu.Schema<qubu.SchemaTableRecord>,
  adapter: DialectAdapter,
): Readonly<Record<string, drizzle.Table>> {
  const snapshot = adapter.createSnapshot(schema)

  assertRepresentableMetadata(snapshot, adapter.dialect)

  const tables: TableRecord = {}
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
  table: qubu.AnyTable,
  snapshotTable: snapshot.SnapshotTable,
  adapter: DialectAdapter,
): Record<string, ColumnBuilder> {
  const definitions = table.definitions as qubu.TableDefinitions
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
  definition: ColumnDefinition,
  column: snapshot.SnapshotColumn,
  table: snapshot.SnapshotTable,
  adapter: DialectAdapter,
): ColumnBuilder {
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
    builder = builder.default(drizzle.sql.raw(column.default.expression.sql))
  } else if (
    column.default?.kind === "external" &&
    definition.defaultFn === undefined &&
    adapter.dialect === "sqlite"
  ) {
    throw unsupportedMetadata(
      `Drizzle SQLite cannot safely represent externally managed default metadata for column "${table.id}.${column.id}"`,
      ["tables", table.id, "columns", column.id, "default"],
    )
  }

  if (column.generatedColumn?.kind === "external") {
    throw unsupportedMetadata(
      `Drizzle cannot safely omit externally managed generated column "${table.id}.${column.id}"`,
      ["tables", table.id, "columns", column.id, "generatedColumn"],
    )
  }

  if (column.generatedColumn?.kind === "expression") {
    builder = builder.generatedAlwaysAs(drizzle.sql.raw(column.generatedColumn.expression.sql), {
      mode: column.generatedColumn.mode,
    })
  }

  if (column.onUpdate !== undefined) {
    if (adapter.applyOnUpdate === undefined) {
      throw unsupportedMetadata(
        `Drizzle ${adapter.dialect} cannot represent column ON UPDATE metadata`,
        ["tables", table.id, "columns", column.id, "onUpdate"],
      )
    }

    builder = adapter.applyOnUpdate(builder, column, table)
  }

  if (column.identity !== undefined) {
    builder = adapter.applyIdentity(builder, definition, column, table)
  }

  return builder
}

function decodeSnapshotLiteral(value: snapshot.SnapshotLiteral): unknown {
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
  table: snapshot.SnapshotTable,
  columns: ColumnRecord,
  tables: TableRecord,
  adapter: DialectAdapter,
): readonly unknown[] {
  return [
    ...table.constraints.flatMap((constraint) =>
      createConstraint(constraint, columns, tables, adapter),
    ),
    ...table.indexes.map((index) => createIndex(index, columns, adapter)),
  ]
}

function createConstraint(
  constraint: snapshot.SnapshotConstraint,
  columns: ColumnRecord,
  tables: TableRecord,
  adapter: DialectAdapter,
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
      (localColumns[0] as (drizzle.Column & { primary?: boolean }) | undefined)?.primary === true
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
    return [
      adapter.createCheck(constraint.physicalName, drizzle.sql.raw(constraint.expression.sql)),
    ]
  }

  if (constraint.kind !== "foreign-key") {
    throw unsupportedMetadata(`Drizzle cannot represent constraint kind "${constraint.kind}"`, [
      "constraints",
      constraint.id,
      "kind",
    ])
  }

  const foreignTable = tables[constraint.target.table.id]
  const foreignColumns = foreignTable
    ? constraint.target.columns.map((column) => drizzle.getTableColumns(foreignTable)[column])
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
  index: snapshot.SnapshotIndex,
  columns: ColumnRecord,
  adapter: DialectAdapter,
): unknown {
  const terms = index.terms.map((term) => createIndexTerm(term, columns))
  const predicate = index.predicate ? drizzle.sql.raw(index.predicate.sql) : undefined

  return adapter.createIndex(index, terms, predicate)
}

function createIndexTerm(term: snapshot.SnapshotIndexTerm, columns: ColumnRecord): IndexTerm {
  const expression = createIndexTermExpression(term, columns)
  const suffix = [term.direction, term.nulls && `NULLS ${term.nulls}`]
    .filter((value): value is string => value !== undefined)
    .join(" ")

  return suffix.length === 0 ? expression : drizzle.sql`${expression} ${drizzle.sql.raw(suffix)}`
}

function createIndexTermExpression(
  term: snapshot.SnapshotIndexTermExpression,
  columns: ColumnRecord,
): IndexTerm {
  if (term.kind === "expression") {
    return drizzle.sql.raw(term.expression.sql)
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

function toDrizzleAction(action: string): ReferentialAction {
  return action.replace("-", " ") as ReferentialAction
}

function assertRepresentableMetadata(
  schemaSnapshot: snapshot.SchemaSnapshot,
  dialect: DrizzleDialect,
): void {
  for (const table of schemaSnapshot.tables) {
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

      for (const [termIndex, term] of index.terms.entries()) {
        if (term.nulls !== undefined && dialect !== "postgresql") {
          throw unsupportedMetadata(
            `Drizzle ${dialect} indexes cannot represent NULLS ${term.nulls}`,
            [...path, "terms", termIndex, "nulls"],
          )
        }
      }

      assertIndexExtension(index.dialect, dialect, path)
    }
  }
}

function assertConstraintExtension(
  extension: snapshot.SnapshotDialectExtension | undefined,
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
  extension: snapshot.SnapshotDialectExtension | undefined,
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
  extension: snapshot.SnapshotDialectExtension | undefined,
): Readonly<Record<string, snapshot.SnapshotJsonValue | undefined>> {
  const data = extension?.data

  return data !== null && typeof data === "object" && !Array.isArray(data)
    ? (data as Readonly<Record<string, snapshot.SnapshotJsonValue | undefined>>)
    : {}
}

export function stringExtension(
  data: Readonly<Record<string, snapshot.SnapshotJsonValue | undefined>>,
  key: string,
): string | undefined {
  const value = data[key]

  return typeof value === "string" ? value : undefined
}

export function recordExtension(
  data: Readonly<Record<string, snapshot.SnapshotJsonValue | undefined>>,
  key: string,
): Record<string, unknown> | undefined {
  const value = data[key]

  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

export function unsupportedMetadata(
  message: string,
  path: readonly (string | number)[],
): DrizzleSchemaConversionError {
  return new DrizzleSchemaConversionError("unsupported-metadata", message, path)
}
