import { createDialect, type PaginationPart } from "../core/dialect.ts"
import type { RenderContext } from "../core/fragment.ts"
import { sqliteExplain } from "./explain.ts"
import { sqliteJson } from "./json.ts"

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
