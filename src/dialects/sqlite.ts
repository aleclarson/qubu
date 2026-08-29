import { createDialect, type PaginationPart } from "../core/dialect.ts"
import type { RenderContext } from "../core/fragment.ts"
import type { SqlTimestamp } from "../core/sql-types.ts"
import {
  nativeColumn,
  nativeStorage,
  type ColumnDefinition,
  type NativeColumnStorage,
} from "../schema/column.ts"
import { sqliteExplain } from "./explain.ts"
import { sqliteJson } from "./json.ts"

/** Integer encoding used by SQLite timestamp columns. */
export type SqliteTimestampMode = "timestamp" | "timestamp_ms"

/** Options for a SQLite integer timestamp. */
export interface SqliteTimestampOptions {
  /** Store Unix seconds by default, or milliseconds with `timestamp_ms`. */
  readonly mode?: SqliteTimestampMode
  readonly nullable?: boolean
  readonly sqlName?: string
  /** Supply an application value when an insert omits this column. */
  readonly defaultFn?: () => Date
}

type SqliteTimestampNullable<TOptions extends SqliteTimestampOptions> = TOptions extends {
  readonly nullable: true
}
  ? true
  : false

type SqliteTimestampHasRuntimeDefault<TOptions extends SqliteTimestampOptions> = TOptions extends {
  readonly defaultFn: () => Date
}
  ? true
  : false

/** Qubu definition for a SQLite `INTEGER` timestamp exposed as a JavaScript `Date`. */
export type SqliteTimestampColumn<TOptions extends SqliteTimestampOptions = {}> = ColumnDefinition<{
  readonly output: Date
  readonly nullable: SqliteTimestampNullable<TOptions>
  readonly hasRuntimeDefault: SqliteTimestampHasRuntimeDefault<TOptions>
  readonly sqlType: SqlTimestamp
  readonly storage: NativeColumnStorage<"sqlite", "INTEGER">
}>

/** Declare a SQLite `INTEGER` timestamp with a live Date codec. */
export function sqliteTimestamp<const TOptions extends SqliteTimestampOptions = {}>(
  options?: TOptions,
): SqliteTimestampColumn<TOptions> {
  const mode = options?.mode ?? "timestamp"
  const scale = mode === "timestamp" ? 1_000 : 1
  const definition = nativeColumn<Date, Date, Date>(nativeStorage("sqlite", "INTEGER"), {
    nullable: options?.nullable === true,
    sqlName: options?.sqlName,
    defaultFn: options?.defaultFn,
    codec: {
      toDriver(value: Date) {
        if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
          throw new TypeError("SQLite timestamps require a valid Date")
        }

        return mode === "timestamp" ? Math.floor(value.getTime() / scale) : value.getTime()
      },
      fromDriver(value: unknown) {
        if (value instanceof Date) {
          return value
        }

        if (typeof value !== "number" && typeof value !== "bigint") {
          throw new TypeError("SQLite timestamp results require a numeric value")
        }

        const timestamp = Number(value)
        if (!Number.isFinite(timestamp) || !Number.isInteger(timestamp)) {
          throw new TypeError("SQLite timestamp results require a finite integer")
        }

        const decoded = new Date(timestamp * scale)
        if (Number.isNaN(decoded.getTime())) {
          throw new TypeError("SQLite timestamp result is outside the valid Date range")
        }

        return decoded
      },
    },
  }).$type<Date>()

  return definition as unknown as SqliteTimestampColumn<TOptions>
}

function renderSqliteSchemaLiteral(value: unknown): string {
  if (value === null) {
    return "NULL"
  }

  if (typeof value === "boolean") {
    return value ? "1" : "0"
  }

  if (typeof value === "string") {
    return `'${value.replaceAll("'", "''")}'`
  }

  if (typeof value === "bigint") {
    return String(value)
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("SQLite schema literals require finite numbers")
    }

    return Object.is(value, -0) ? "0" : String(value)
  }

  throw new TypeError(
    `Unsupported SQLite schema literal type: ${value === undefined ? "undefined" : typeof value}`,
  )
}

function renderSqlitePagination(context: RenderContext, parts: readonly PaginationPart[]) {
  const fetch = parts.find((part) => part.kind === "fetch")
  const offset = parts.find((part) => part.kind === "offset")

  context.append("LIMIT ")
  if (fetch) {
    context.parameter(fetch.rows)
  } else {
    context.append("-1")
  }

  if (offset) {
    context.append(" OFFSET ")
    context.parameter(offset.rows)
  }
}

export function sqliteDialect() {
  return createDialect({
    name: "sqlite",
    placeholder: () => "?",
    pagination: { render: renderSqlitePagination },
    capabilities: ["on-conflict"],
    json: sqliteJson,
    castTypes: {
      decimal: "NUMERIC",
      boolean: "INTEGER",
      date: "TEXT",
      timestamp: "TEXT",
      uuid: "TEXT",
      json: "TEXT",
      binary: "BLOB",
    },
    renderSchemaLiteral: renderSqliteSchemaLiteral,
    explain: sqliteExplain,
  })
}

export { doNothing, doUpdate, excluded, onConflict } from "../query/mutation/on-conflict.ts"
export type {
  ConflictAction,
  ConflictTarget,
  DoNothingAction,
  DoUpdateAction,
  ExcludedSource,
  OnConflictClause,
} from "../query/mutation/on-conflict.ts"
