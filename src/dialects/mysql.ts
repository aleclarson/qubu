import {
  createDialect,
  type DialectRowLocking,
  type PaginationPart,
  type RowLockMode,
  type RowLockWaitPolicy,
} from "../core/dialect.ts"
import type { RenderContext } from "../core/fragment.ts"
import { queryValidationError } from "../query/errors.ts"
import { mysqlExplain } from "./explain.ts"
import { mysqlJson } from "./json.ts"

const mysqlRowLocking: DialectRowLocking = {
  render(context, mode: RowLockMode, wait: RowLockWaitPolicy) {
    if (mode !== "update" && mode !== "share") {
      throw queryValidationError({
        code: "invalid-row-lock",
        context: "dialect.mysql.row-lock",
        path: ["rowLock", "mode"],
        message: `MySQL does not support the "${mode}" row-lock mode`,
        hint: "Use update or share with the MySQL dialect.",
      })
    }

    context.append(mode === "update" ? "FOR UPDATE" : "FOR SHARE")
    if (wait === "nowait") {
      context.append(" NOWAIT")
    }

    if (wait === "skip-locked") {
      context.append(" SKIP LOCKED")
    }
  },
}

function renderPagination(context: RenderContext, parts: readonly PaginationPart[]) {
  const fetch = parts.find((part) => part.kind === "fetch")
  const offset = parts.find((part) => part.kind === "offset")

  context.append("LIMIT ")
  // mysql2 sends JavaScript numbers as DOUBLE parameters, which MySQL rejects
  // for LIMIT/OFFSET in prepared statements.
  if (fetch) {
    context.append(String(fetch.rows))
  } else {
    context.append("18446744073709551615")
  }

  if (offset) {
    context.append(" OFFSET ")
    context.append(String(offset.rows))
  }
}

// MySQL interprets backslash escapes in string literals unless
// NO_BACKSLASH_ESCAPES is set, so literal text must double them.
function renderSchemaLiteral(value: unknown): string {
  if (value === null) {
    return "NULL"
  }

  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE"
  }

  if (typeof value === "string") {
    return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "''")}'`
  }

  if (typeof value === "bigint") {
    return String(value)
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("MySQL schema literals require finite numbers")
    }

    return Object.is(value, -0) ? "0" : String(value)
  }

  throw new TypeError(
    `Unsupported MySQL schema literal type: ${value === undefined ? "undefined" : typeof value}`,
  )
}

export function mysqlDialect() {
  return createDialect({
    name: "mysql",
    quoteIdentifier: (identifier) => `\`${identifier.replaceAll("`", "``")}\``,
    placeholder: () => "?",
    renderSchemaLiteral,
    pagination: { render: renderPagination },
    rowLocking: mysqlRowLocking,
    json: mysqlJson,
    capabilities: ["row-locking", "on-duplicate-key-update"],
    castTypes: {
      integer: "SIGNED",
      text: "CHAR",
      boolean: "UNSIGNED",
      timestamp: "DATETIME",
      uuid: "CHAR",
      bigint: "SIGNED",
      binary: "BINARY",
    },
    explain: mysqlExplain,
  })
}

export {
  incoming,
  onDuplicateKeyUpdate,
  type IncomingColumns,
  type IncomingIdentity,
  type OnDuplicateKeyUpdateClause,
} from "../query/mutation/on-duplicate-key-update.ts"
