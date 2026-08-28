import type { SQL } from "drizzle-orm"
import {
  bigint,
  boolean,
  char,
  check,
  customType,
  date,
  datetime,
  decimal,
  foreignKey,
  index,
  int,
  json,
  mysqlSchema,
  mysqlTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
  type MySqlColumn,
  type MySqlTableWithColumns,
} from "drizzle-orm/mysql-core"
import {
  type AnyTable,
  type PortableColumnStorage,
  type Schema,
  type SchemaTableRecord,
} from "qubu"
import { createMysqlSchemaSnapshot } from "qubu/snapshot"

import {
  convertDrizzleSchema,
  extensionData,
  stringExtension,
  type DrizzleRuntimeAdapter,
  type RuntimeColumnBuilder,
  type RuntimeForeignKeyBuilder,
  type RuntimeIndexBuilder,
  type RuntimeTableFactory,
} from "./runtime.ts"
import type { DrizzleColumnConfig, DrizzleSchemaValidation } from "./types.ts"

type MysqlDrizzleColumn<TTableName extends string, TDefinition> = MySqlColumn<
  DrizzleColumnConfig<TTableName, TDefinition>
>

type MysqlDrizzleColumns<TTable extends AnyTable> = {
  [TKey in keyof TTable["definitions"]]: MysqlDrizzleColumn<
    TTable["tableName"],
    TTable["definitions"][TKey]
  >
}

/** The Drizzle MySQL table produced for one Qubu table. */
export type MysqlDrizzleTable<TTable extends AnyTable> = MySqlTableWithColumns<{
  name: TTable["tableName"]
  schema: string | undefined
  columns: MysqlDrizzleColumns<TTable>
  dialect: "mysql"
}>

/** A MySQL Drizzle table record retaining Qubu's logical table keys. */
export type MysqlDrizzleSchema<TSchema extends Schema<any>> = {
  readonly [TKey in keyof TSchema["tables"]]: MysqlDrizzleTable<TSchema["tables"][TKey]>
}

const mysqlAdapter: DrizzleRuntimeAdapter = {
  dialect: "mysql",
  createSnapshot: createMysqlSchemaSnapshot,
  createTableFactory(namespace) {
    return (namespace === undefined
      ? mysqlTable
      : mysqlSchema(namespace).table) as unknown as RuntimeTableFactory
  },
  createStorageBuilder: createMysqlStorageBuilder,
  applyIdentity(builder, definition) {
    const extension = definition.identity?.dialect
    const autoIncrement =
      extension?.dialect === "mysql" &&
      "autoIncrement" in extension &&
      extension.autoIncrement === true

    return autoIncrement && builder.autoincrement ? builder.autoincrement() : builder
  },
  createPrimaryKey(name, columns) {
    return (primaryKey as (config: object) => unknown)({
      name,
      columns,
    })
  },
  createUniqueConstraint(name, columns) {
    return unique(name).on(...(columns as [MySqlColumn, ...MySqlColumn[]]))
  },
  createCheck: check,
  createForeignKey(name, columns, foreignColumns) {
    return (foreignKey as (config: object) => RuntimeForeignKeyBuilder)({
      name,
      columns,
      foreignColumns,
    })
  },
  createIndex(indexDefinition, terms) {
    const data = extensionData(indexDefinition.dialect)
    const start = indexDefinition.unique
      ? uniqueIndex(indexDefinition.physicalName)
      : index(indexDefinition.physicalName)
    let builder = start.on(
      ...(terms as [MySqlColumn | SQL, ...(MySqlColumn | SQL)[]]),
    ) as unknown as RuntimeIndexBuilder
    const using = stringExtension(data, "using")
    const algorithm = stringExtension(data, "algorithm")
    const lock = stringExtension(data, "lock")

    if (using) {
      builder = builder.using(using)
    }

    if (algorithm) {
      builder = builder.algorithm(algorithm)
    }

    if (lock) {
      builder = builder.lock(lock)
    }

    return builder
  },
}

/**
 * Convert a live Qubu schema registry into MySQL Drizzle table objects.
 *
 * @throws A snapshot validation error for invalid MySQL metadata, or a DrizzleSchemaConversionError
 *   when Drizzle cannot represent required metadata.
 */
export function toMysqlDrizzleSchema<const TTables extends SchemaTableRecord>(
  schema: Schema<TTables> & DrizzleSchemaValidation<TTables, "mysql">,
): MysqlDrizzleSchema<Schema<TTables>> {
  return convertDrizzleSchema(schema, mysqlAdapter) as MysqlDrizzleSchema<Schema<TTables>>
}

function createMysqlStorageBuilder(
  type: PortableColumnStorage["type"] | undefined,
  name: string,
  declaration: string,
): RuntimeColumnBuilder {
  const builder = (() => {
    switch (type) {
      case "integer": {
        return int(name)
      }

      case "numeric": {
        return decimal(name, { mode: "number" })
      }

      case "text": {
        return text(name)
      }

      case "boolean": {
        return boolean(name)
      }

      case "date": {
        return date(name, { mode: "date" })
      }

      case "timestamp": {
        return datetime(name, { mode: "date" })
      }

      case "uuid": {
        return char(name, { length: 36 })
      }

      case "json": {
        return json(name)
      }

      case "bigint": {
        return bigint(name, { mode: "bigint" })
      }

      case "binary": {
        return customType({ dataType: () => declaration })(name)
      }

      default: {
        return customType({ dataType: () => declaration })(name)
      }
    }
  })()

  return builder as unknown as RuntimeColumnBuilder
}
