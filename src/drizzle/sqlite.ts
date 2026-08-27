import type { SQL } from 'drizzle-orm'
import {
  blob,
  check,
  customType,
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
  type SQLiteColumn,
  type SQLiteTableWithColumns,
} from 'drizzle-orm/sqlite-core'
import type { SqlTimestamp } from '../core/sql-types.ts'
import {
  nativeColumn,
  type ColumnDefinition,
  type NativeColumnStorage,
  type PortableColumnStorage,
} from '../schema/column.ts'
import type { ExternalDefaultDescriptor } from '../schema/column-behavior.ts'
import type { Schema, SchemaTableRecord } from '../schema/registry.ts'
import type { AnyTable } from '../schema/table.ts'
import { createSqliteSchemaSnapshot } from '../snapshot/sqlite.ts'
import {
  convertDrizzleSchema,
  type DrizzleRuntimeAdapter,
  type RuntimeColumnBuilder,
  type RuntimeForeignKeyBuilder,
  type RuntimeIndexBuilder,
  type RuntimeQubuColumnDefinition,
  type RuntimeTableFactory,
} from './runtime.ts'
import type { DrizzleColumnConfig, DrizzleSchemaValidation } from './types.ts'

type SqliteDrizzleColumn<TTableName extends string, TDefinition> = SQLiteColumn<
  DrizzleColumnConfig<TTableName, TDefinition>
>

type SqliteDrizzleColumns<TTable extends AnyTable> = {
  [TKey in keyof TTable['definitions']]: SqliteDrizzleColumn<
    TTable['tableName'],
    TTable['definitions'][TKey]
  >
}

/** Integer encoding used by Drizzle's SQLite timestamp column builder. */
export type SqliteTimestampMode = 'timestamp' | 'timestamp_ms'

/** Runtime options for a Drizzle-compatible SQLite integer timestamp. */
export interface SqliteTimestampOptions {
  /** Store Unix seconds by default, or milliseconds with `timestamp_ms`. */
  readonly mode?: SqliteTimestampMode
  readonly nullable?: boolean
  readonly sqlName?: string
  /** Supply an application value when a Drizzle insert omits this column. */
  readonly defaultFn?: () => Date
}

type SqliteTimestampNullable<TOptions extends SqliteTimestampOptions> =
  TOptions extends { readonly nullable: true } ? true : false

type SqliteTimestampHasDefault<TOptions extends SqliteTimestampOptions> =
  TOptions extends { readonly defaultFn: () => Date } ? true : false

/** Qubu definition produced by {@link sqliteTimestamp}. */
export type SqliteTimestampColumn<
  TOptions extends SqliteTimestampOptions = {},
> = ColumnDefinition<
  Date,
  SqliteTimestampNullable<TOptions>,
  Date,
  Date,
  SqliteTimestampHasDefault<TOptions>,
  false,
  SqlTimestamp,
  NativeColumnStorage<'sqlite', 'INTEGER'>,
  SqliteTimestampHasDefault<TOptions> extends true
    ? ExternalDefaultDescriptor
    : undefined,
  undefined,
  undefined,
  undefined
>

type SqliteTimestampRuntime = {
  readonly mode: SqliteTimestampMode
  readonly defaultFn?: () => Date
}

const sqliteTimestampRuntime = new WeakMap<
  RuntimeQubuColumnDefinition,
  SqliteTimestampRuntime
>()

/**
 * Declare a SQLite `INTEGER` timestamp that retains Drizzle's Date codec.
 *
 * @remarks `defaultFn` is runtime-only. Snapshots and emitted DDL retain the
 * native `INTEGER` storage but do not serialize the callback.
 */
export function sqliteTimestamp<
  const TOptions extends SqliteTimestampOptions = {},
>(options?: TOptions): SqliteTimestampColumn<TOptions> {
  const definition = nativeColumn('sqlite', 'INTEGER', {
    nullable: options?.nullable === true,
    hasDefault: options?.defaultFn !== undefined,
    sqlName: options?.sqlName,
  }).$type<Date>()
  sqliteTimestampRuntime.set(
    definition,
    Object.freeze({
      mode: options?.mode ?? 'timestamp',
      ...(options?.defaultFn === undefined
        ? {}
        : { defaultFn: options.defaultFn }),
    })
  )
  return definition as unknown as SqliteTimestampColumn<TOptions>
}

/** The Drizzle SQLite table produced for one Qubu table. */
export type SqliteDrizzleTable<TTable extends AnyTable> =
  SQLiteTableWithColumns<{
    name: TTable['tableName']
    schema: undefined
    columns: SqliteDrizzleColumns<TTable>
    dialect: 'sqlite'
  }>

/** A SQLite Drizzle table record retaining Qubu's logical table keys. */
export type SqliteDrizzleSchema<TSchema extends Schema<any>> = {
  readonly [TKey in keyof TSchema['tables']]: SqliteDrizzleTable<
    TSchema['tables'][TKey]
  >
}

const sqliteAdapter: DrizzleRuntimeAdapter = {
  dialect: 'sqlite',
  createSnapshot: createSqliteSchemaSnapshot,
  createTableFactory() {
    return sqliteTable as unknown as RuntimeTableFactory
  },
  createStorageBuilder: createSqliteStorageBuilder,
  applyIdentity(builder, definition, column, table) {
    const extension = definition.identity?.dialect
    const autoIncrement =
      extension?.dialect === 'sqlite' &&
      'autoIncrement' in extension &&
      extension.autoIncrement === true
    const isSingleColumnPrimaryKey = table.constraints.some(
      constraint =>
        constraint.kind === 'primary-key' &&
        constraint.columns.length === 1 &&
        constraint.columns[0] === column.id
    )
    return autoIncrement && isSingleColumnPrimaryKey && builder.primaryKey
      ? builder.primaryKey({ autoIncrement: true })
      : builder
  },
  createPrimaryKey(name, columns) {
    return (primaryKey as (config: object) => unknown)({ name, columns })
  },
  createUniqueConstraint(name, columns) {
    return unique(name).on(...(columns as [SQLiteColumn, ...SQLiteColumn[]]))
  },
  createCheck: check,
  createForeignKey(name, columns, foreignColumns) {
    return (foreignKey as (config: object) => RuntimeForeignKeyBuilder)({
      name,
      columns,
      foreignColumns,
    })
  },
  createIndex(indexDefinition, terms, predicate) {
    const start = indexDefinition.unique
      ? uniqueIndex(indexDefinition.physicalName)
      : index(indexDefinition.physicalName)
    let builder = start.on(
      ...(terms as [SQLiteColumn | SQL, ...(SQLiteColumn | SQL)[]])
    ) as unknown as RuntimeIndexBuilder
    if (predicate) builder = builder.where(predicate)
    return builder
  },
}

/**
 * Convert a live Qubu schema registry into SQLite Drizzle table objects.
 *
 * @throws A snapshot validation error for invalid SQLite metadata, or a
 * DrizzleSchemaConversionError when Drizzle cannot represent required metadata.
 */
export function toSqliteDrizzleSchema<const TTables extends SchemaTableRecord>(
  schema: Schema<TTables> & DrizzleSchemaValidation<TTables, 'sqlite'>
): SqliteDrizzleSchema<Schema<TTables>> {
  return convertDrizzleSchema(schema, sqliteAdapter) as SqliteDrizzleSchema<
    Schema<TTables>
  >
}

function createSqliteStorageBuilder(
  type: PortableColumnStorage['type'] | undefined,
  name: string,
  declaration: string,
  definition: RuntimeQubuColumnDefinition
): RuntimeColumnBuilder {
  const timestampRuntime = sqliteTimestampRuntime.get(definition)
  if (timestampRuntime !== undefined) {
    let builder = integer(name, {
      mode: timestampRuntime.mode,
    }) as unknown as RuntimeColumnBuilder
    if (timestampRuntime.defaultFn !== undefined) {
      builder = builder.$defaultFn(timestampRuntime.defaultFn)
    }
    return builder
  }

  const builder = (() => {
    switch (type) {
      case 'integer':
        return integer(name)
      case 'numeric':
        return customType<{ data: number; driverData: number | string }>({
          dataType: () => declaration,
          fromDriver: value => Number(value),
        })(name)
      case 'text':
        return text(name)
      case 'boolean':
        return integer(name, { mode: 'boolean' })
      case 'date':
        return customType<{ data: Date; driverData: string }>({
          dataType: () => declaration,
          fromDriver: value => new Date(value),
          toDriver: value => value.toISOString().slice(0, 10),
        })(name)
      case 'timestamp':
        return customType<{ data: Date; driverData: string }>({
          dataType: () => declaration,
          fromDriver: value => new Date(value),
          toDriver: value => value.toISOString(),
        })(name)
      case 'uuid':
        return text(name)
      case 'json':
        return text(name, { mode: 'json' })
      case 'bigint':
        return customType<{
          data: bigint
          driverData: bigint | number | string
        }>({
          dataType: () => declaration,
          fromDriver: value => BigInt(value),
        })(name)
      case 'binary':
        return blob(name, { mode: 'buffer' })
      default:
        return customType({ dataType: () => declaration })(name)
    }
  })()
  return builder as unknown as RuntimeColumnBuilder
}
