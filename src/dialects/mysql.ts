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

function renderMySqlPagination(context: RenderContext, parts: readonly PaginationPart[]) {
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

export function mysqlDialect() {
  return createDialect({
    name: "mysql",
    quoteIdentifier: (identifier) => `\`${identifier.replaceAll("`", "``")}\``,
    placeholder: () => "?",
    pagination: { render: renderMySqlPagination },
    rowLocking: mysqlRowLocking,
    json: mysqlJson,
    capabilities: ["row-locking"],
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
