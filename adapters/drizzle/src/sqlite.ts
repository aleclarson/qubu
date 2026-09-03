import type * as drizzle from "drizzle-orm"
import {
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
  unsupportedMetadata,
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
  createStorageBuilder,
  applyIdentity(builder, definition, column, table) {
    if (column.identity === undefined) {
      return builder
    }

    const extension = definition.identity?.dialect
    const autoIncrement =
      extension?.dialect === "sqlite" &&
      "autoIncrement" in extension &&
      extension.autoIncrement === true

    if (
      autoIncrement &&
      !(
        definition.columnCodec === undefined &&
        definition.storage?.kind === "portable" &&
        definition.storage.type === "integer"
      )
    ) {
      throw unsupportedMetadata(
        `Drizzle SQLite cannot represent AUTOINCREMENT identity metadata for column "${table.id}.${column.id}"`,
        ["tables", table.id, "columns", column.id, "identity", "dialect", "autoIncrement"],
      )
    }

    if (builder.primaryKey === undefined) {
      throw unsupportedMetadata(
        `Drizzle SQLite cannot represent identity metadata for column "${table.id}.${column.id}"`,
        ["tables", table.id, "columns", column.id, "identity"],
      )
    }

    return autoIncrement ? builder.primaryKey({ autoIncrement: true }) : builder.primaryKey()
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
export function toDrizzleSchema<const TTables extends qubu.SchemaTableRecord>(
  schema: qubu.Schema<TTables> & DrizzleSchemaValidation<TTables, "sqlite">,
): SqliteDrizzleSchema<qubu.Schema<TTables>> {
  return convertDrizzleSchema(schema, sqliteAdapter) as SqliteDrizzleSchema<qubu.Schema<TTables>>
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
          fromDriver: decodeSqliteTimestamp,
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
          fromDriver: decodeSqliteBigint,
        })(name)
      }

      case "binary": {
        return customType<{
          data: Uint8Array
          driverData: Uint8Array | ArrayBuffer
        }>({
          dataType: () => declaration,
          fromDriver: decodeSqliteBinary,
          toDriver: (value) => new Uint8Array(value),
        })(name)
      }

      default: {
        return customType({ dataType: () => declaration })(name)
      }
    }
  })()

  return builder as unknown as ColumnBuilder
}

function decodeSqliteTimestamp(value: string): Date {
  if (typeof value !== "string") {
    throw new TypeError("SQLite timestamp values must be strings")
  }

  const match =
    /^(\d{4})-(\d{2})-(\d{2})(?:(?:T| )(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:?\d{2})?)?$/iu.exec(
      value,
    )

  if (match === null) {
    throw new TypeError(`Invalid SQLite timestamp value "${value}"`)
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = match[4] === undefined ? 0 : Number(match[4])
  const minute = match[5] === undefined ? 0 : Number(match[5])
  const second = match[6] === undefined ? 0 : Number(match[6])
  const zone = match[8]

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    throw new TypeError(`Invalid SQLite timestamp value "${value}"`)
  }

  if (zone !== undefined && zone.toUpperCase() !== "Z") {
    const offset = /[+-](\d{2}):?(\d{2})/u.exec(zone)

    if (offset === null || Number(offset[1]) > 23 || Number(offset[2]) > 59) {
      throw new TypeError(`Invalid SQLite timestamp value "${value}"`)
    }
  }

  const fraction = (match[7] ?? "").slice(0, 3).padEnd(3, "0")
  const normalized = `${match[1]}-${match[2]}-${match[3]}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}.${fraction}${zone?.toUpperCase() ?? "Z"}`
  const result = new Date(normalized)

  if (Number.isNaN(result.getTime())) {
    throw new TypeError(`Invalid SQLite timestamp value "${value}"`)
  }

  return result
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)

    return leapYear ? 29 : 28
  }

  return [31, 0, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0
}

function decodeSqliteBigint(value: bigint | number | string): bigint {
  if (typeof value === "bigint") {
    return value
  }

  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new TypeError(`SQLite bigint number must be a safe integer, received ${value}`)
    }

    return BigInt(value)
  }

  if (typeof value !== "string") {
    throw new TypeError("SQLite bigint values must be bigint, safe integer numbers, or strings")
  }

  if (!/^[+-]?\d+$/u.test(value)) {
    throw new TypeError(
      `SQLite bigint string must be an exact decimal integer, received "${value}"`,
    )
  }

  return BigInt(value)
}

function decodeSqliteBinary(value: Uint8Array | ArrayBuffer): Uint8Array {
  if (value instanceof Uint8Array) {
    return new Uint8Array(value)
  }

  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value.slice(0))
  }

  throw new TypeError("SQLite binary values must be Uint8Array-compatible")
}
