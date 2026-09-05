import { extendDialect, type Dialect } from "qubu/core"
import { postgresDialect } from "qubu/postgres"

import { pgvectorCapability } from "./query.ts"

/** PostgreSQL's query dialect plus the capability required by pgvector expressions. */
export function dialect(): Dialect<
  "ilike" | "json" | "on-conflict" | "row-locking" | "update-from" | typeof pgvectorCapability
> {
  return extendDialect(postgresDialect(), [pgvectorCapability])
}
