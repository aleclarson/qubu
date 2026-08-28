import { createDialect } from "../core/dialect.ts"
import { standardJson } from "./json.ts"

/** SQL:2008-style rendering defaults used by the core builder. */
export function standardDialect() {
  return createDialect({
    name: "standard-sql",
    placeholder: () => "?",
    json: standardJson,
  })
}
