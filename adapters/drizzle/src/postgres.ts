import type { SQL } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  customType,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type PgColumn,
  type PgTableWithColumns,
} from 'drizzle-orm/pg-core'
import {
  type AnyTable,
  type PortableColumnStorage,
  type Schema,
  type SchemaTableRecord,
} from 'qubu'
import { createPostgresSchemaSnapshot } from 'qubu/snapshot'
import {
  convertDrizzleSchema,
  extensionData,
  recordExtension,
  stringExtension,
  type DrizzleRuntimeAdapter,
  type RuntimeColumnBuilder,
  type RuntimeForeignKeyBuilder,
  type RuntimeIndexBuilder,
  type RuntimeTableFactory,
} from './runtime.ts'
import type { DrizzleColumnConfig, DrizzleSchemaValidation } from './types.ts'

type PostgresDrizzleColumn<TTableName extends string, TDefinition> = PgColumn<
  'custom',
  DrizzleColumnConfig<TTableName, TDefinition>
>

type PostgresDrizzleColumns<TTable extends AnyTable> = {
  [TKey in keyof TTable['definitions']]: PostgresDrizzleColumn<
    TTable['tableName'],
    TTable['definitions'][TKey]
  >
}

/** The Drizzle PostgreSQL table produced for one Qubu table. */
export type PostgresDrizzleTable<TTable extends AnyTable> = PgTableWithColumns<{
  name: TTable['tableName']
  schema: string | undefined
  columns: PostgresDrizzleColumns<TTable>
  dialect: 'pg'
}>

/** A PostgreSQL Drizzle table record retaining Qubu's logical table keys. */
export type PostgresDrizzleSchema<TSchema extends Schema<any>> = {
  readonly [TKey in keyof TSchema['tables']]: PostgresDrizzleTable<
    TSchema['tables'][TKey]
  >
}

const postgresAdapter: DrizzleRuntimeAdapter = {
  dialect: 'postgresql',
  createSnapshot: createPostgresSchemaSnapshot,
  createTableFactory(namespace) {
    return (namespace === undefined
      ? pgTable
      : pgSchema(namespace).table) as unknown as RuntimeTableFactory
  },
  createStorageBuilder: createPostgresStorageBuilder,
  applyIdentity(builder, _definition, column) {
    const method =
      column.identity?.generation === 'always'
        ? builder.generatedAlwaysAsIdentity
        : builder.generatedByDefaultAsIdentity
    return method === undefined ? builder : method.call(builder)
  },
  createPrimaryKey(name, columns) {
    return (primaryKey as (config: object) => unknown)({ name, columns })
  },
  createUniqueConstraint(name, columns, nullsNotDistinct) {
    const builder = unique(name).on(...(columns as [PgColumn, ...PgColumn[]]))
    return nullsNotDistinct ? builder.nullsNotDistinct() : builder
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
    const data = extensionData(indexDefinition.dialect)
    const start = indexDefinition.unique
      ? uniqueIndex(indexDefinition.physicalName)
      : index(indexDefinition.physicalName)
    const method = stringExtension(data, 'method')
    let builder = (method
      ? start.using(method, ...(terms as [SQL, ...SQL[]]))
      : start.on(
          ...(terms as [SQL, ...SQL[]])
        )) as unknown as RuntimeIndexBuilder
    if (data.concurrently === true) builder = builder.concurrently()
    const storageParameters = recordExtension(data, 'storageParameters')
    if (storageParameters) builder = builder.with(storageParameters)
    if (predicate) builder = builder.where(predicate)
    return builder
  },
}

/**
 * Convert a live Qubu schema registry into PostgreSQL Drizzle table objects.
 *
 * @throws A snapshot validation error for invalid PostgreSQL metadata, or a
 * DrizzleSchemaConversionError when Drizzle cannot represent required metadata.
 */
export function toPostgresDrizzleSchema<
  const TTables extends SchemaTableRecord,
>(
  schema: Schema<TTables> & DrizzleSchemaValidation<TTables, 'postgresql'>
): PostgresDrizzleSchema<Schema<TTables>> {
  return convertDrizzleSchema(schema, postgresAdapter) as PostgresDrizzleSchema<
    Schema<TTables>
  >
}

function createPostgresStorageBuilder(
  type: PortableColumnStorage['type'] | undefined,
  name: string,
  declaration: string
): RuntimeColumnBuilder {
  const builder = (() => {
    switch (type) {
      case 'integer':
        return integer(name)
      case 'numeric':
        return numeric(name, { mode: 'number' })
      case 'text':
        return text(name)
      case 'boolean':
        return boolean(name)
      case 'date':
        return date(name, { mode: 'date' })
      case 'timestamp':
        return timestamp(name, { mode: 'date' })
      case 'uuid':
        return uuid(name)
      case 'json':
        return jsonb(name)
      case 'bigint':
        return bigint(name, { mode: 'bigint' })
      case 'binary':
        return customType({ dataType: () => declaration })(name)
      default:
        return customType({ dataType: () => declaration })(name)
    }
  })()
  return builder as unknown as RuntimeColumnBuilder
}
