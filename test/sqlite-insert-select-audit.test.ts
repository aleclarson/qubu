import { expect, test } from "vitest"

import { doNothing, onConflict, sqliteDialect } from "../src/dialects/sqlite.ts"
import {
  from,
  gt,
  insertInto,
  insertSelect,
  integer,
  render,
  select,
  table,
  where,
} from "../src/index.ts"

test.each([false, true])(
  "disambiguates SQLite INSERT SELECT conflict handling (source filter: %s)",
  (filtered) => {
    const incoming = table("incoming", { id: integer() })
    const records = table("records", { id: integer() })
    const source = filtered
      ? select({ id: incoming.id }, from(incoming), where(gt(incoming.id, 0)))
      : select({ id: incoming.id }, from(incoming))
    const statement = render(
      insertInto(records, insertSelect(source, ["id"]), onConflict(doNothing())),
      sqliteDialect(),
    )

    // Without a WHERE clause, SQLite treats ON as a possible join condition
    // and rejects this bulk insert at DO. An unfiltered source needs a
    // tautological WHERE to preserve its rows while resolving the ambiguity.
    expect(statement.text).toMatch(/\bWHERE\b[\s\S]*\bON CONFLICT DO NOTHING$/u)
    if (filtered) {
      expect(statement.parameters).toEqual([0])
    }
  },
)
