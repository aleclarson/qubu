import { getTableColumns, sql, type SQL } from 'drizzle-orm'
import {
  bigint as pgBigint,
  boolean as pgBoolean,
  check as pgCheck,
  customType as pgCustomType,
  date as pgDate,
  foreignKey as pgForeignKey,
  index as pgIndex,
  integer as pgInteger,
  jsonb as pgJsonb,
  numeric as pgNumeric,
  pgSchema,
  pgTable,
  primaryKey as pgPrimaryKey,
  text as pgText,
  timestamp as pgTimestamp,
  unique as pgUnique,
  uniqueIndex as pgUniqueIndex,
  uuid as pgUuid,
  type PgColumn,
  type PgTable,
  type PgTableWithColumns,
} from 'drizzle-orm/pg-core'
import {
  bigint as mysqlBigint,
  boolean as mysqlBoolean,
  char as mysqlChar,
  check as mysqlCheck,
  customType as mysqlCustomType,
  date as mysqlDate,
  datetime as mysqlDateTime,
  decimal as mysqlDecimal,
  foreignKey as mysqlForeignKey,
  index as mysqlIndex,
  int as mysqlInteger,
  json as mysqlJson,
  mysqlSchema,
  mysqlTable,
  primaryKey as mysqlPrimaryKey,
  text as mysqlText,
  unique as mysqlUnique,
  uniqueIndex as mysqlUniqueIndex,
  type MySqlColumn,
  type MySqlTable,
  type MySqlTableWithColumns,
} from 'drizzle-orm/mysql-core'
import {
  blob as sqliteBlob,
  check as sqliteCheck,
  customType as sqliteCustomType,
  foreignKey as sqliteForeignKey,
  index as sqliteIndex,
  integer as sqliteInteger,
  primaryKey as sqlitePrimaryKey,
  sqliteTable,
  text as sqliteText,
  unique as sqliteUnique,
  uniqueIndex as sqliteUniqueIndex,
  type SQLiteColumn,
  type SQLiteTable,
  type SQLiteTableWithColumns,
} from 'drizzle-orm/sqlite-core'
import type {
  ColumnHasDefault,
  ColumnIdentityOf,
  ColumnInsertInput,
  ColumnIsGenerated,
  ColumnOutput,
  ColumnStorageOf,
  ColumnUpdateInput,
  NativeColumnStorage,
  PortableColumnStorage,
} from '../schema/column.ts'
import type { Schema, SchemaTableRecord } from '../schema/registry.ts'
import type { AnyTable, TableDefinitions } from '../schema/table.ts'
import { createMysqlSchemaSnapshot } from '../snapshot/mysql.ts'
import { createPostgresSchemaSnapshot } from '../snapshot/postgres.ts'
import { createSqliteSchemaSnapshot } from '../snapshot/sqlite.ts'
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
} from '../snapshot/types.ts'

/** SQL engines supported by the Qubu-to-Drizzle runtime adapter. */
export type DrizzleDialect = 'postgresql' | 'mysql' | 'sqlite'

/** Stable failure categories raised while building a Drizzle schema. */
export type DrizzleSchemaConversionErrorCode =
  | 'missing-storage'
  | 'unsupported-metadata'

/** A path-addressed failure raised when Drizzle cannot represent Qubu metadata. */
export class DrizzleSchemaConversionError extends TypeError {
  readonly name = 'DrizzleSchemaConversionError'
  readonly code: DrizzleSchemaConversionErrorCode
  readonly path: readonly (string | number)[]

  constructor(
    code: DrizzleSchemaConversionErrorCode,
    message: string,
    path: readonly (string | number)[]
  ) {
    super(message)
    this.code = code
    this.path = Object.freeze([...path])
  }
}

type IsAny<T> = 0 extends 1 & T ? true : false

type SameType<TLeft, TRight> =
  IsAny<TLeft> extends true
    ? true
    : IsAny<TRight> extends true
      ? true
      : (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight
            ? 1
            : 2
        ? (<T>() => T extends TRight ? 1 : 2) extends <T>() => T extends TLeft
            ? 1
            : 2
          ? true
          : false
        : false

type HasCompatibleValueTypes<TDefinition> =
  SameType<
    ColumnOutput<TDefinition>,
    ColumnInsertInput<TDefinition>
  > extends true
    ? SameType<ColumnOutput<TDefinition>, ColumnUpdateInput<TDefinition>>
    : false

type HasCompatibleStorage<TDefinition, TDialect extends DrizzleDialect> =
  ColumnStorageOf<TDefinition> extends infer TStorage
    ? TStorage extends PortableColumnStorage
      ? true
      : TStorage extends NativeColumnStorage<infer TStorageDialect, string>
        ? TDialect extends TStorageDialect
          ? true
          : false
        : false
    : false

type InvalidValueTypeColumns<TTables extends SchemaTableRecord> = {
  [TTableKey in keyof TTables & string]: {
    [TColumnKey in keyof TTables[TTableKey]['definitions'] &
      string]: HasCompatibleValueTypes<
      TTables[TTableKey]['definitions'][TColumnKey]
    > extends true
      ? never
      : `${TTableKey}.${TColumnKey}`
  }[keyof TTables[TTableKey]['definitions'] & string]
}[keyof TTables & string]

type InvalidStorageColumns<
  TTables extends SchemaTableRecord,
  TDialect extends DrizzleDialect,
> = {
  [TTableKey in keyof TTables & string]: {
    [TColumnKey in keyof TTables[TTableKey]['definitions'] &
      string]: HasCompatibleStorage<
      TTables[TTableKey]['definitions'][TColumnKey],
      TDialect
    > extends true
      ? never
      : `${TTableKey}.${TColumnKey}`
  }[keyof TTables[TTableKey]['definitions'] & string]
}[keyof TTables & string]

type DrizzleSchemaValidation<
  TTables extends SchemaTableRecord,
  TDialect extends DrizzleDialect,
> = ([InvalidValueTypeColumns<TTables>] extends [never]
  ? unknown
  : {
      readonly __drizzle_requires_one_value_type__: InvalidValueTypeColumns<TTables>
    }) &
  ([InvalidStorageColumns<TTables, TDialect>] extends [never]
    ? unknown
    : {
        readonly __drizzle_requires_compatible_storage__: InvalidStorageColumns<
          TTables,
          TDialect
        >
      })

type DrizzleColumnIdentity<TDefinition> =
  ColumnIdentityOf<TDefinition> extends {
    readonly generation: infer TGeneration
  }
    ? TGeneration extends 'always'
      ? 'always'
      : TGeneration extends 'by-default'
        ? 'byDefault'
        : undefined
    : undefined

type DrizzleColumnGenerated<TDefinition> =
  ColumnIsGenerated<TDefinition> extends true
    ? {
        readonly as: ColumnOutput<TDefinition>
        readonly type: 'always'
      }
    : undefined

type DrizzleColumnHasDefault<TDefinition> =
  ColumnIsGenerated<TDefinition> extends true
    ? true
    : ColumnHasDefault<TDefinition>

type DrizzleColumnConfig<
  TTableName extends string,
  TDefinition,
  TColumnType extends string,
> = {
  readonly name: string
  readonly tableName: TTableName
  readonly dataType: 'custom'
  readonly columnType: TColumnType
  readonly data: ColumnOutput<TDefinition>
  readonly driverParam: ColumnInsertInput<TDefinition>
  readonly enumValues: undefined
  /**
   * Qubu makes nullable columns required on insert unless they have a default.
   * Keeping this flag true and carrying null in `data` preserves that rule in
   * Drizzle's single-axis column model.
   */
  readonly notNull: true
  readonly hasDefault: DrizzleColumnHasDefault<TDefinition>
  readonly isPrimaryKey: false
  readonly isAutoincrement: false
  readonly hasRuntimeDefault: false
  readonly identity: DrizzleColumnIdentity<TDefinition>
  readonly generated: DrizzleColumnGenerated<TDefinition>
}

type DrizzleColumn<
  TTableName extends string,
  TDefinition,
  TDialect extends DrizzleDialect,
> = TDialect extends 'postgresql'
  ? PgColumn<DrizzleColumnConfig<TTableName, TDefinition, 'PgCustomColumn'>>
  : TDialect extends 'mysql'
    ? MySqlColumn<
        DrizzleColumnConfig<TTableName, TDefinition, 'MySqlCustomColumn'>
      >
    : SQLiteColumn<
        DrizzleColumnConfig<TTableName, TDefinition, 'SQLiteCustomColumn'>
      >

type DrizzleColumns<
  TTable extends AnyTable,
  TDialect extends DrizzleDialect,
> = {
  [TKey in keyof TTable['definitions']]: DrizzleColumn<
    TTable['tableName'],
    TTable['definitions'][TKey],
    TDialect
  >
}

/** The dialect-specific Drizzle table produced for one Qubu table. */
export type DrizzleTable<
  TTable extends AnyTable,
  TDialect extends DrizzleDialect,
> = TDialect extends 'postgresql'
  ? PgTableWithColumns<{
      name: TTable['tableName']
      schema: string | undefined
      columns: DrizzleColumns<TTable, TDialect>
      dialect: 'pg'
    }>
  : TDialect extends 'mysql'
    ? MySqlTableWithColumns<{
        name: TTable['tableName']
        schema: string | undefined
        columns: DrizzleColumns<TTable, TDialect>
        dialect: 'mysql'
      }>
    : SQLiteTableWithColumns<{
        name: TTable['tableName']
        schema: undefined
        columns: DrizzleColumns<TTable, TDialect>
        dialect: 'sqlite'
      }>

/** A Drizzle table record retaining the Qubu schema's logical table keys. */
export type DrizzleSchema<
  TSchema extends Schema<any>,
  TDialect extends DrizzleDialect,
> = {
  readonly [TKey in keyof TSchema['tables']]: DrizzleTable<
    TSchema['tables'][TKey],
    TDialect
  >
}

type RuntimeColumnBuilder = {
  notNull(): RuntimeColumnBuilder
  default(value: unknown): RuntimeColumnBuilder
  generatedAlwaysAs(
    value: SQL,
    config?: { readonly mode?: 'stored' | 'virtual' }
  ): RuntimeColumnBuilder
  $onUpdateFn(callback: () => SQL): RuntimeColumnBuilder
  primaryKey?(config?: {
    readonly autoIncrement?: boolean
  }): RuntimeColumnBuilder
  autoincrement?(): RuntimeColumnBuilder
  generatedAlwaysAsIdentity?(): RuntimeColumnBuilder
  generatedByDefaultAsIdentity?(): RuntimeColumnBuilder
}

type RuntimeColumnRecord = Record<string, PgColumn | MySqlColumn | SQLiteColumn>
type RuntimeTableRecord = Record<string, PgTable | MySqlTable | SQLiteTable>

type RuntimeTableFactory = (
  name: string,
  columns: Record<string, RuntimeColumnBuilder>,
  extraConfig: (columns: RuntimeColumnRecord) => readonly unknown[]
) => PgTable | MySqlTable | SQLiteTable

type RuntimeForeignKeyBuilder = {
  onUpdate(action: RuntimeReferentialAction): RuntimeForeignKeyBuilder
  onDelete(action: RuntimeReferentialAction): RuntimeForeignKeyBuilder
}

type RuntimeIndexBuilder = {
  concurrently(): RuntimeIndexBuilder
  with(values: Record<string, unknown>): RuntimeIndexBuilder
  where(condition: SQL): RuntimeIndexBuilder
  using(value: string): RuntimeIndexBuilder
  algorithm(value: string): RuntimeIndexBuilder
  lock(value: string): RuntimeIndexBuilder
}

type RuntimeReferentialAction =
  | 'cascade'
  | 'restrict'
  | 'no action'
  | 'set null'
  | 'set default'

type RuntimeQubuColumnDefinition = TableDefinitions[string]

/**
 * Convert a live Qubu schema registry into real Drizzle table objects.
 *
 * @remarks The return value keeps logical table and field keys, physical SQL
 * names, supported namespaces, column storage, concrete defaults and generated
 * expressions, constraints, and indexes. External behavior descriptors retain
 * their write types without inventing missing SQL. Qubu's selected, inserted,
 * and updated application types must agree because Drizzle models those
 * operations with one column value type.
 *
 * @param schema A Qubu schema whose columns have storage for the chosen dialect.
 * @param dialect The Drizzle SQL table family to construct.
 * @returns A record accepted as Drizzle's runtime `schema` option.
 * @throws {@link DrizzleSchemaConversionError} when Drizzle cannot represent
 * required metadata, or a snapshot validation error when the Qubu schema is
 * invalid for the selected SQL dialect.
 */
export function toDrizzleSchema<
  const TTables extends SchemaTableRecord,
  const TDialect extends DrizzleDialect,
>(
  schema: Schema<TTables> & DrizzleSchemaValidation<TTables, TDialect>,
  dialect: TDialect
): DrizzleSchema<Schema<TTables>, TDialect> {
  const snapshot = createDialectSnapshot(schema, dialect)
  assertRepresentableMetadata(snapshot, dialect)

  const tables: RuntimeTableRecord = {}
  const tableFactory = createTableFactory(schema.namespace, dialect)
  const snapshotTables = new Map(
    snapshot.tables.map(table => [table.id, table] as const)
  )

  for (const [tableId, entry] of Object.entries(schema.registry)) {
    const snapshotTable = snapshotTables.get(tableId)
    if (snapshotTable === undefined) continue
    const qubuTable = entry.table
    const columns = createColumns(qubuTable, snapshotTable, dialect)
    tables[snapshotTable.id] = tableFactory(
      snapshotTable.physicalName,
      columns,
      drizzleColumns =>
        createExtraConfig(snapshotTable, drizzleColumns, tables, dialect)
    )
  }

  return Object.freeze({ ...tables }) as DrizzleSchema<
    Schema<TTables>,
    TDialect
  >
}

function createDialectSnapshot(
  schema: Schema<SchemaTableRecord>,
  dialect: DrizzleDialect
): SchemaSnapshot {
  switch (dialect) {
    case 'postgresql':
      return createPostgresSchemaSnapshot(schema)
    case 'mysql':
      return createMysqlSchemaSnapshot(schema)
    case 'sqlite':
      return createSqliteSchemaSnapshot(schema)
  }
}

function createTableFactory(
  namespace: string | undefined,
  dialect: DrizzleDialect
): RuntimeTableFactory {
  switch (dialect) {
    case 'postgresql':
      return (namespace === undefined
        ? pgTable
        : pgSchema(namespace).table) as unknown as RuntimeTableFactory
    case 'mysql':
      return (namespace === undefined
        ? mysqlTable
        : mysqlSchema(namespace).table) as unknown as RuntimeTableFactory
    case 'sqlite':
      return sqliteTable as unknown as RuntimeTableFactory
  }
}

function createColumns(
  table: AnyTable,
  snapshotTable: SnapshotTable,
  dialect: DrizzleDialect
): Record<string, RuntimeColumnBuilder> {
  const definitions = table.definitions as TableDefinitions
  const snapshotColumns = new Map(
    snapshotTable.columns.map(column => [column.id, column] as const)
  )
  return Object.fromEntries(
    Object.entries(definitions).map(([columnId, definition]) => {
      const snapshotColumn = snapshotColumns.get(columnId)
      if (snapshotColumn === undefined) {
        throw new DrizzleSchemaConversionError(
          'missing-storage',
          `Qubu column "${snapshotTable.id}.${columnId}" has no snapshot definition`,
          ['tables', snapshotTable.id, 'columns', columnId]
        )
      }
      return [
        snapshotColumn.id,
        createColumnBuilder(definition, snapshotColumn, snapshotTable, dialect),
      ]
    })
  )
}

function createColumnBuilder(
  definition: RuntimeQubuColumnDefinition,
  column: SnapshotColumn,
  table: SnapshotTable,
  dialect: DrizzleDialect
): RuntimeColumnBuilder {
  const declaration = column.storage?.type
  if (declaration === undefined) {
    throw new DrizzleSchemaConversionError(
      'missing-storage',
      `Qubu column "${table.id}.${column.id}" needs physical storage before it can become a Drizzle column`,
      ['tables', table.id, 'columns', column.id, 'storage']
    )
  }

  let builder = createStorageBuilder(
    definition,
    column.physicalName,
    declaration,
    dialect
  )
  if (!column.nullable) builder = builder.notNull()

  if (column.default?.kind === 'literal') {
    builder = builder.default(decodeSnapshotLiteral(column.default.value))
  } else if (column.default?.kind === 'expression') {
    builder = builder.default(sql.raw(column.default.expression.sql))
  }

  if (column.generatedColumn?.kind === 'expression') {
    builder = builder.generatedAlwaysAs(
      sql.raw(column.generatedColumn.expression.sql),
      { mode: column.generatedColumn.mode }
    )
  }

  if (column.onUpdate !== undefined) {
    builder = builder.$onUpdateFn(() => sql.raw(column.onUpdate?.sql ?? ''))
  }

  if (column.identity !== undefined) {
    builder = applyIdentity(builder, definition, column, table, dialect)
  }

  return builder
}

function createStorageBuilder(
  definition: RuntimeQubuColumnDefinition,
  name: string,
  declaration: string,
  dialect: DrizzleDialect
): RuntimeColumnBuilder {
  const portableType =
    definition.storage?.kind === 'portable'
      ? definition.storage.type
      : undefined

  switch (dialect) {
    case 'postgresql':
      return createPostgresStorageBuilder(portableType, name, declaration)
    case 'mysql':
      return createMysqlStorageBuilder(portableType, name, declaration)
    case 'sqlite':
      return createSqliteStorageBuilder(portableType, name, declaration)
  }
}

function createPostgresStorageBuilder(
  type: PortableColumnStorage['type'] | undefined,
  name: string,
  declaration: string
): RuntimeColumnBuilder {
  const builder = (() => {
    switch (type) {
      case 'integer':
        return pgInteger(name)
      case 'numeric':
        return pgNumeric(name, { mode: 'number' })
      case 'text':
        return pgText(name)
      case 'boolean':
        return pgBoolean(name)
      case 'date':
        return pgDate(name, { mode: 'date' })
      case 'timestamp':
        return pgTimestamp(name, { mode: 'date' })
      case 'uuid':
        return pgUuid(name)
      case 'json':
        return pgJsonb(name)
      case 'bigint':
        return pgBigint(name, { mode: 'bigint' })
      case 'binary':
        return pgCustomType({ dataType: () => declaration })(name)
      default:
        return pgCustomType({ dataType: () => declaration })(name)
    }
  })()
  return builder as unknown as RuntimeColumnBuilder
}

function createMysqlStorageBuilder(
  type: PortableColumnStorage['type'] | undefined,
  name: string,
  declaration: string
): RuntimeColumnBuilder {
  const builder = (() => {
    switch (type) {
      case 'integer':
        return mysqlInteger(name)
      case 'numeric':
        return mysqlDecimal(name, { mode: 'number' })
      case 'text':
        return mysqlText(name)
      case 'boolean':
        return mysqlBoolean(name)
      case 'date':
        return mysqlDate(name, { mode: 'date' })
      case 'timestamp':
        return mysqlDateTime(name, { mode: 'date' })
      case 'uuid':
        return mysqlChar(name, { length: 36 })
      case 'json':
        return mysqlJson(name)
      case 'bigint':
        return mysqlBigint(name, { mode: 'bigint' })
      case 'binary':
        return mysqlCustomType({ dataType: () => declaration })(name)
      default:
        return mysqlCustomType({ dataType: () => declaration })(name)
    }
  })()
  return builder as unknown as RuntimeColumnBuilder
}

function createSqliteStorageBuilder(
  type: PortableColumnStorage['type'] | undefined,
  name: string,
  declaration: string
): RuntimeColumnBuilder {
  const builder = (() => {
    switch (type) {
      case 'integer':
        return sqliteInteger(name)
      case 'numeric':
        return sqliteCustomType<{ data: number; driverData: number | string }>({
          dataType: () => declaration,
          fromDriver: value => Number(value),
        })(name)
      case 'text':
        return sqliteText(name)
      case 'boolean':
        return sqliteInteger(name, { mode: 'boolean' })
      case 'date':
        return sqliteCustomType<{ data: Date; driverData: string }>({
          dataType: () => declaration,
          fromDriver: value => new Date(value),
          toDriver: value => value.toISOString().slice(0, 10),
        })(name)
      case 'timestamp':
        return sqliteCustomType<{ data: Date; driverData: string }>({
          dataType: () => declaration,
          fromDriver: value => new Date(value),
          toDriver: value => value.toISOString(),
        })(name)
      case 'uuid':
        return sqliteText(name)
      case 'json':
        return sqliteText(name, { mode: 'json' })
      case 'bigint':
        return sqliteCustomType<{
          data: bigint
          driverData: bigint | number | string
        }>({
          dataType: () => declaration,
          fromDriver: value => BigInt(value),
        })(name)
      case 'binary':
        return sqliteBlob(name, { mode: 'buffer' })
      default:
        return sqliteCustomType({ dataType: () => declaration })(name)
    }
  })()
  return builder as unknown as RuntimeColumnBuilder
}

function applyIdentity(
  builder: RuntimeColumnBuilder,
  definition: RuntimeQubuColumnDefinition,
  column: SnapshotColumn,
  table: SnapshotTable,
  dialect: DrizzleDialect
): RuntimeColumnBuilder {
  if (dialect === 'postgresql') {
    const method =
      column.identity?.generation === 'always'
        ? builder.generatedAlwaysAsIdentity
        : builder.generatedByDefaultAsIdentity
    return method === undefined ? builder : method.call(builder)
  }

  const extension = definition.identity?.dialect
  const autoIncrement =
    extension?.dialect === dialect && 'autoIncrement' in extension
      ? extension.autoIncrement === true
      : false

  if (dialect === 'mysql' && autoIncrement && builder.autoincrement) {
    return builder.autoincrement()
  }

  if (
    dialect === 'sqlite' &&
    autoIncrement &&
    builder.primaryKey &&
    table.constraints.some(
      constraint =>
        constraint.kind === 'primary-key' &&
        constraint.columns.length === 1 &&
        constraint.columns[0] === column.id
    )
  ) {
    return builder.primaryKey({ autoIncrement: true })
  }

  return builder
}

function decodeSnapshotLiteral(value: SnapshotLiteral): unknown {
  switch (value.kind) {
    case 'null':
      return null
    case 'boolean':
    case 'string':
      return value.value
    case 'number':
      return Number(value.value)
    case 'bigint':
      return BigInt(value.value)
  }
}

function createExtraConfig(
  table: SnapshotTable,
  columns: RuntimeColumnRecord,
  tables: RuntimeTableRecord,
  dialect: DrizzleDialect
): readonly unknown[] {
  return [
    ...table.constraints.flatMap(constraint =>
      createConstraint(constraint, columns, tables, dialect)
    ),
    ...table.indexes.map(index => createIndex(index, columns, dialect)),
  ]
}

function createConstraint(
  constraint: SnapshotConstraint,
  columns: RuntimeColumnRecord,
  tables: RuntimeTableRecord,
  dialect: DrizzleDialect
): readonly unknown[] {
  const localColumns =
    constraint.kind === 'check'
      ? []
      : constraint.columns.map(column => columns[column])

  if (constraint.kind !== 'check' && localColumns.some(value => !value)) {
    throw unsupportedMetadata(
      `Drizzle could not resolve every column in constraint "${constraint.id}"`,
      ['constraints', constraint.id, 'columns']
    )
  }

  if (constraint.kind === 'primary-key') {
    if (
      dialect === 'sqlite' &&
      localColumns.length === 1 &&
      (localColumns[0] as SQLiteColumn | undefined)?.primary === true
    ) {
      return []
    }
    return [createPrimaryKey(dialect, constraint.physicalName, localColumns)]
  }

  if (constraint.kind === 'unique' || constraint.kind === 'unique-constraint') {
    return [
      createUniqueConstraint(
        dialect,
        constraint.physicalName,
        localColumns,
        constraint.kind === 'unique-constraint' &&
          constraint.nulls === 'not-distinct'
      ),
    ]
  }

  if (constraint.kind === 'check') {
    return [
      createCheck(
        dialect,
        constraint.physicalName,
        sql.raw(constraint.expression.sql)
      ),
    ]
  }

  if (constraint.kind !== 'foreign-key') {
    throw unsupportedMetadata(
      `Drizzle cannot represent constraint kind "${constraint.kind}"`,
      ['constraints', constraint.id, 'kind']
    )
  }

  const foreignTable = tables[constraint.target.table]
  const foreignColumns = foreignTable
    ? constraint.target.columns.map(
        column => getTableColumns(foreignTable)[column]
      )
    : []
  if (
    foreignColumns.length !== constraint.target.columns.length ||
    foreignColumns.some(value => !value)
  ) {
    throw unsupportedMetadata(
      `Drizzle could not resolve the target of foreign key "${constraint.id}"`,
      ['constraints', constraint.id, 'target']
    )
  }

  let builder = createForeignKey(
    dialect,
    constraint.physicalName,
    localColumns,
    foreignColumns
  )
  if (constraint.onUpdate) {
    builder = builder.onUpdate(toDrizzleAction(constraint.onUpdate))
  }
  if (constraint.onDelete) {
    builder = builder.onDelete(toDrizzleAction(constraint.onDelete))
  }
  return [builder]
}

function createPrimaryKey(
  dialect: DrizzleDialect,
  name: string,
  columns: readonly unknown[]
): unknown {
  const config = { name, columns }
  switch (dialect) {
    case 'postgresql':
      return (pgPrimaryKey as (config: object) => unknown)(config)
    case 'mysql':
      return (mysqlPrimaryKey as (config: object) => unknown)(config)
    case 'sqlite':
      return (sqlitePrimaryKey as (config: object) => unknown)(config)
  }
}

function createUniqueConstraint(
  dialect: DrizzleDialect,
  name: string,
  columns: readonly unknown[],
  nullsNotDistinct: boolean
): unknown {
  const create = (() => {
    switch (dialect) {
      case 'postgresql':
        return pgUnique
      case 'mysql':
        return mysqlUnique
      case 'sqlite':
        return sqliteUnique
    }
  })() as unknown as (name: string) => {
    on(...columns: readonly unknown[]): unknown
  }
  const builder = create(name).on(...columns) as {
    nullsNotDistinct?: () => unknown
  }
  return nullsNotDistinct && builder.nullsNotDistinct
    ? builder.nullsNotDistinct()
    : builder
}

function createCheck(
  dialect: DrizzleDialect,
  name: string,
  expression: SQL
): unknown {
  switch (dialect) {
    case 'postgresql':
      return pgCheck(name, expression)
    case 'mysql':
      return mysqlCheck(name, expression)
    case 'sqlite':
      return sqliteCheck(name, expression)
  }
}

function createForeignKey(
  dialect: DrizzleDialect,
  name: string,
  columns: readonly unknown[],
  foreignColumns: readonly unknown[]
): RuntimeForeignKeyBuilder {
  const config = { name, columns, foreignColumns }
  switch (dialect) {
    case 'postgresql':
      return (pgForeignKey as (config: object) => RuntimeForeignKeyBuilder)(
        config
      )
    case 'mysql':
      return (mysqlForeignKey as (config: object) => RuntimeForeignKeyBuilder)(
        config
      )
    case 'sqlite':
      return (sqliteForeignKey as (config: object) => RuntimeForeignKeyBuilder)(
        config
      )
  }
}

function createIndex(
  index: SnapshotIndex,
  columns: RuntimeColumnRecord,
  dialect: DrizzleDialect
): unknown {
  const terms = index.terms.map(term => createIndexTerm(term, columns))
  const extension = extensionData(index.dialect)

  if (dialect === 'postgresql') {
    const start = index.unique
      ? pgUniqueIndex(index.physicalName)
      : pgIndex(index.physicalName)
    const method = stringExtension(extension, 'method')
    let builder = (method
      ? start.using(method, ...(terms as [SQL, ...SQL[]]))
      : start.on(
          ...(terms as [SQL, ...SQL[]])
        )) as unknown as RuntimeIndexBuilder
    if (extension.concurrently === true) builder = builder.concurrently()
    const storageParameters = recordExtension(extension, 'storageParameters')
    if (storageParameters) builder = builder.with(storageParameters)
    if (index.predicate) builder = builder.where(sql.raw(index.predicate.sql))
    return builder
  }

  if (dialect === 'mysql') {
    const start = index.unique
      ? mysqlUniqueIndex(index.physicalName)
      : mysqlIndex(index.physicalName)
    let builder = start.on(
      ...(terms as [MySqlColumn | SQL, ...(MySqlColumn | SQL)[]])
    ) as unknown as RuntimeIndexBuilder
    const using = stringExtension(extension, 'using')
    const algorithm = stringExtension(extension, 'algorithm')
    const lock = stringExtension(extension, 'lock')
    if (using) builder = builder.using(using)
    if (algorithm) builder = builder.algorithm(algorithm)
    if (lock) builder = builder.lock(lock)
    return builder
  }

  const start = index.unique
    ? sqliteUniqueIndex(index.physicalName)
    : sqliteIndex(index.physicalName)
  let builder = start.on(
    ...(terms as [SQLiteColumn | SQL, ...(SQLiteColumn | SQL)[]])
  ) as unknown as RuntimeIndexBuilder
  if (index.predicate) builder = builder.where(sql.raw(index.predicate.sql))
  return builder
}

function createIndexTerm(
  term: SnapshotIndexTerm,
  columns: RuntimeColumnRecord
): PgColumn | MySqlColumn | SQLiteColumn | SQL {
  if (term.kind !== 'order') return createIndexTermExpression(term, columns)
  const expression = createIndexTermExpression(term.expression, columns)
  const suffix = [term.direction, term.nulls && `NULLS ${term.nulls}`]
    .filter((value): value is string => value !== undefined)
    .join(' ')
  return suffix.length === 0
    ? expression
    : sql`${expression} ${sql.raw(suffix)}`
}

function createIndexTermExpression(
  term: SnapshotIndexTermExpression,
  columns: RuntimeColumnRecord
): PgColumn | MySqlColumn | SQLiteColumn | SQL {
  if (term.kind === 'expression') return sql.raw(term.expression.sql)
  const column = columns[term.column]
  if (column === undefined) {
    throw unsupportedMetadata(
      `Drizzle could not resolve index column "${term.column}"`,
      ['indexes', 'terms', term.column]
    )
  }
  return column
}

function toDrizzleAction(action: string): RuntimeReferentialAction {
  return action.replace('-', ' ') as RuntimeReferentialAction
}

function assertRepresentableMetadata(
  snapshot: SchemaSnapshot,
  dialect: DrizzleDialect
): void {
  for (const table of snapshot.tables) {
    for (const constraint of table.constraints) {
      const path = ['tables', table.id, 'constraints', constraint.id] as const
      if (
        constraint.deferrable === true ||
        constraint.initially !== undefined
      ) {
        throw unsupportedMetadata(
          `Drizzle cannot represent deferred constraint "${constraint.id}"`,
          path
        )
      }
      if (
        constraint.kind === 'foreign-key' &&
        constraint.match !== undefined &&
        constraint.match !== 'simple'
      ) {
        throw unsupportedMetadata(
          `Drizzle cannot represent MATCH ${constraint.match.toUpperCase()} on foreign key "${constraint.id}"`,
          [...path, 'match']
        )
      }
      assertConstraintExtension(constraint.dialect, dialect, path)
    }

    for (const index of table.indexes) {
      const path = ['tables', table.id, 'indexes', index.id] as const
      if (index.includedColumns && index.includedColumns.length > 0) {
        throw unsupportedMetadata(
          `Drizzle ${dialect} indexes cannot represent included columns`,
          [...path, 'includedColumns']
        )
      }
      assertIndexExtension(index.dialect, dialect, path)
    }
  }
}

function assertConstraintExtension(
  extension: SnapshotDialectExtension | undefined,
  dialect: DrizzleDialect,
  path: readonly (string | number)[]
): void {
  const data = extensionData(extension)
  const unsupported = Object.entries(data).find(([key, value]) => {
    if (value === undefined) return false
    if (dialect === 'postgresql' && key === 'notValid') return value === true
    if (dialect === 'mysql' && key === 'enforced') return value === false
    if (dialect === 'sqlite' && key === 'onConflict') return true
    if (value === false) return false
    return true
  })
  if (unsupported) {
    throw unsupportedMetadata(
      `Drizzle cannot represent constraint option "${unsupported[0]}"`,
      [...path, 'dialect', unsupported[0]]
    )
  }
}

function assertIndexExtension(
  extension: SnapshotDialectExtension | undefined,
  dialect: DrizzleDialect,
  path: readonly (string | number)[]
): void {
  const data = extensionData(extension)
  const supported =
    dialect === 'postgresql'
      ? new Set(['method', 'concurrently', 'storageParameters'])
      : dialect === 'mysql'
        ? new Set(['using', 'algorithm', 'lock'])
        : new Set<string>()

  const unsupported = Object.entries(data).find(
    ([key, value]) =>
      value !== undefined && value !== false && !supported.has(key)
  )
  if (unsupported) {
    throw unsupportedMetadata(
      `Drizzle cannot represent index option "${unsupported[0]}"`,
      [...path, 'dialect', unsupported[0]]
    )
  }
}

function extensionData(
  extension: SnapshotDialectExtension | undefined
): Readonly<Record<string, SnapshotJsonValue | undefined>> {
  const data = extension?.data
  return data !== null && typeof data === 'object' && !Array.isArray(data)
    ? (data as Readonly<Record<string, SnapshotJsonValue | undefined>>)
    : {}
}

function stringExtension(
  data: Readonly<Record<string, SnapshotJsonValue | undefined>>,
  key: string
): string | undefined {
  const value = data[key]
  return typeof value === 'string' ? value : undefined
}

function recordExtension(
  data: Readonly<Record<string, SnapshotJsonValue | undefined>>,
  key: string
): Record<string, unknown> | undefined {
  const value = data[key]
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function unsupportedMetadata(
  message: string,
  path: readonly (string | number)[]
): DrizzleSchemaConversionError {
  return new DrizzleSchemaConversionError('unsupported-metadata', message, path)
}
