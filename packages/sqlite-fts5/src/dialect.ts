import { extendDialect, type Dialect } from "qubu/core"
import { sqliteDialect } from "qubu/sqlite"

import { fts5Capability } from "./table.ts"

/** SQLite's normal query dialect plus the capability required by FTS5 sources and expressions. */
export function dialect(): Dialect<"json" | "on-conflict" | typeof fts5Capability> {
  return extendDialect(sqliteDialect(), [fts5Capability])
}
