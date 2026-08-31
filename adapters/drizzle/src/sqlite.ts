import type * as drizzle from "drizzle-orm"
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
} from "drizzle-orm/sqlite-core"
import type * as qubu from "qubu"
import { createSchemaSnapshot } from "qubu/snapshot/sqlite"

import {
  convertDrizzleSchema,
  type ColumnBuilder,
  type ColumnDefinition,
  type DialectAdapter,
  type ForeignKeyBuilder,
  type IndexBuilder,
  type TableFactory,
} from "./runtime.ts"
import type { DrizzleColumnConfig, DrizzleSchemaValidation } from "./types.ts"

type SqliteDrizzleColumn<TTableName extends string, TDefinition> = SQLiteColumn<
  DrizzleColumnConfig<TTableName, TDefinition>
>

type SqliteDrizzleColumns<TTable extends qubu.AnyTable> = {
  [TKey in keyof TTable["definitions"]]: SqliteDrizzleColumn<
    TTable["tableName"],
    TTable["definitions"][TKey]
  >
}

/** The Drizzle SQLite table produced for one Qubu table. */
export type SqliteDrizzleTable<TTable extends qubu.AnyTable> = SQLiteTableWithColumns<{
  name: TTable["tableName"]
  schema: undefined
  columns: SqliteDrizzleColumns<TTable>
  dialect: "sqlite"
}>

/** A SQLite Drizzle table record retaining Qubu's logical table keys. */
export type SqliteDrizzleSchema<TSchema extends qubu.Schema<any>> = {
  readonly [TKey in keyof TSchema["tables"]]: SqliteDrizzleTable<TSchema["tables"][TKey]>
}

const sqliteAdapter: DialectAdapter = {
  dialect: "sqlite",
  createSnapshot: createSchemaSnapshot,
  createTableFactory() {
    return sqliteTable as unknown as TableFactory
  },
  createStorageBuilder: createSqliteStorageBuilder,
  applyIdentity(builder, definition, column, table) {
    const extension = definition.identity?.dialect
    const autoIncrement =
      extension?.dialect === "sqlite" &&
      "autoIncrement" in extension &&
      extension.autoIncrement === true
    const isSingleColumnPrimaryKey = table.constraints.some(
      (constraint) =>
        constraint.kind === "primary-key" &&
        constraint.columns.length === 1 &&
        constraint.columns[0] === column.id,
    )

    return autoIncrement && isSingleColumnPrimaryKey && builder.primaryKey
      ? builder.primaryKey({ autoIncrement: true })
      : builder
  },
  createPrimaryKey(name, columns) {
    return (primaryKey as (config: object) => unknown)({
      name,
      columns,
    })
  },
  createUniqueConstraint(name, columns) {
    return unique(name).on(...(columns as [SQLiteColumn, ...SQLiteColumn[]]))
  },
  createCheck: check,
  createForeignKey(name, columns, foreignColumns) {
    return (foreignKey as (config: object) => ForeignKeyBuilder)({
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
      ...(terms as [SQLiteColumn | drizzle.SQL, ...(SQLiteColumn | drizzle.SQL)[]]),
    ) as unknown as IndexBuilder

    if (predicate) {
      builder = builder.where(predicate)
    }

    return builder
  },
}

/**
 * Convert a live Qubu schema registry into SQLite Drizzle table objects.
 *
 * @throws A snapshot validation error for invalid SQLite metadata, or a
 *   DrizzleSchemaConversionError when Drizzle cannot represent required metadata.
 */
export function toSqliteDrizzleSchema<const TTables extends qubu.SchemaTableRecord>(
  schema: qubu.Schema<TTables> & DrizzleSchemaValidation<TTables, "sqlite">,
): SqliteDrizzleSchema<qubu.Schema<TTables>> {
  return convertDrizzleSchema(schema, sqliteAdapter) as SqliteDrizzleSchema<qubu.Schema<TTables>>
}

function createSqliteStorageBuilder(
  type: qubu.PortableColumnStorage["type"] | undefined,
  name: string,
  declaration: string,
  definition: ColumnDefinition,
): ColumnBuilder {
  if (definition.columnCodec !== undefined) {
    return customType<{
      data: unknown
      driverData: unknown
    }>({
      dataType: () => declaration,
      toDriver: definition.columnCodec.toDriver,
      fromDriver: definition.columnCodec.fromDriver,
    })(name) as unknown as ColumnBuilder
  }

  const builder = (() => {
    switch (type) {
      case "integer": {
        return integer(name)
      }

      case "numeric": {
        return customType<{
          data: number
          driverData: number | string
        }>({
          dataType: () => declaration,
          fromDriver: (value) => Number(value),
        })(name)
      }

      case "text": {
        return text(name)
      }

      case "boolean": {
        return integer(name, { mode: "boolean" })
      }

      case "date": {
        return customType<{
          data: Date
          driverData: string
        }>({
          dataType: () => declaration,
          fromDriver: (value) => new Date(value),
          toDriver: (value) => value.toISOString().slice(0, 10),
        })(name)
      }

      case "timestamp": {
        return customType<{
          data: Date
          driverData: string
        }>({
          dataType: () => declaration,
          fromDriver: (value) => new Date(value),
          toDriver: (value) => value.toISOString(),
        })(name)
      }

      case "uuid": {
        return text(name)
      }

      case "json": {
        return text(name, { mode: "json" })
      }

      case "bigint": {
        return customType<{
          data: bigint
          driverData: bigint | number | string
        }>({
          dataType: () => declaration,
          fromDriver: (value) => BigInt(value),
        })(name)
      }

      case "binary": {
        return blob(name, { mode: "buffer" })
      }

      default: {
        return customType({ dataType: () => declaration })(name)
      }
    }
  })()

  return builder as unknown as ColumnBuilder
}
