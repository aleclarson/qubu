import type * as drizzle from "drizzle-orm"
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
import type * as qubu from "qubu"
import { createSchemaSnapshot } from "qubu/snapshot/mysql"

import {
  convertDrizzleSchema,
  extensionData,
  stringExtension,
  unsupportedMetadata,
  type ColumnBuilder,
  type ColumnDefinition,
  type DialectAdapter,
  type ForeignKeyBuilder,
  type IndexBuilder,
  type TableFactory,
} from "./runtime.ts"
import type { DrizzleColumnConfig, DrizzleSchemaValidation } from "./types.ts"

type MysqlDrizzleColumn<TTableName extends string, TDefinition> = MySqlColumn<
  DrizzleColumnConfig<TTableName, TDefinition>
>

type MysqlDrizzleColumns<TTable extends qubu.AnyTable> = {
  [TKey in keyof TTable["definitions"]]: MysqlDrizzleColumn<
    TTable["tableName"],
    TTable["definitions"][TKey]
  >
}

/** The Drizzle MySQL table produced for one Qubu table. */
export type MysqlDrizzleTable<TTable extends qubu.AnyTable> = MySqlTableWithColumns<{
  name: TTable["tableName"]
  schema: string | undefined
  columns: MysqlDrizzleColumns<TTable>
  dialect: "mysql"
}>

/** A MySQL Drizzle table record retaining Qubu's logical table keys. */
export type MysqlDrizzleSchema<TSchema extends qubu.Schema<any>> = {
  readonly [TKey in keyof TSchema["tables"]]: MysqlDrizzleTable<TSchema["tables"][TKey]>
}

const mysqlAdapter: DialectAdapter = {
  dialect: "mysql",
  createSnapshot: createSchemaSnapshot,
  createTableFactory(namespace) {
    return (namespace === undefined
      ? mysqlTable
      : mysqlSchema(namespace).table) as unknown as TableFactory
  },
  createStorageBuilder,
  applyIdentity(builder, definition, column, table) {
    const extension = definition.identity?.dialect
    const autoIncrement =
      extension?.dialect === "mysql" && "autoIncrement" in extension
        ? extension.autoIncrement
        : undefined

    if (autoIncrement === false) {
      throw unsupportedMetadata(
        `Drizzle MySQL cannot represent a non-autoincrement identity column "${table.id}.${column.id}"`,
        ["tables", table.id, "columns", column.id, "identity", "dialect", "autoIncrement"],
      )
    }

    if (builder.autoincrement === undefined) {
      throw unsupportedMetadata(
        `Drizzle MySQL cannot represent identity metadata for column "${table.id}.${column.id}"`,
        ["tables", table.id, "columns", column.id, "identity"],
      )
    }

    return builder.autoincrement()
  },
  applyOnUpdate(builder, column, table) {
    const expression = column.onUpdate?.sql.trim() ?? ""
    const match = /^CURRENT_TIMESTAMP(?:\(([0-6])\))?$/iu.exec(expression)

    if (match === null) {
      throw unsupportedMetadata(
        `Drizzle MySQL cannot represent ON UPDATE expression "${expression}"`,
        ["tables", table.id, "columns", column.id, "onUpdate"],
      )
    }

    if (builder.onUpdateNow === undefined) {
      throw unsupportedMetadata(
        `Drizzle MySQL cannot represent ON UPDATE metadata for column "${table.id}.${column.id}"`,
        ["tables", table.id, "columns", column.id, "onUpdate"],
      )
    }

    return match[1] === undefined
      ? builder.onUpdateNow()
      : builder.onUpdateNow({ fsp: Number(match[1]) })
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
    return (foreignKey as (config: object) => ForeignKeyBuilder)({
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
      ...(terms as [MySqlColumn | drizzle.SQL, ...(MySqlColumn | drizzle.SQL)[]]),
    ) as unknown as IndexBuilder
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
export function toDrizzleSchema<const TTables extends qubu.SchemaTableRecord>(
  schema: qubu.Schema<TTables> & DrizzleSchemaValidation<TTables, "mysql">,
): MysqlDrizzleSchema<qubu.Schema<TTables>> {
  return convertDrizzleSchema(schema, mysqlAdapter) as MysqlDrizzleSchema<qubu.Schema<TTables>>
}

function createStorageBuilder(
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

  return builder as unknown as ColumnBuilder
}
