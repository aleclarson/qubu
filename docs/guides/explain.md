# Inspect query plans

> Request a vendor-specific plan, with analysis limited to read queries.

Use an adapter that supports `ExplainableQueryAdapter`. For example, with the
PostgreSQL adapter from [Execute queries](execution.md):

```ts
import { from, integer, qubu, select, table } from "qubu"
import { pgAdapter } from "@qubu/adapter-pg"
import { Pool } from "pg"

const db = qubu(pgAdapter(new Pool()))
const users = table("users", { id: integer() })
const readQuery = select({ id: users.id }, from(users))

const plan = await db.explain(readQuery, { analyze: true, verbose: true })
// plan.rows has the pg adapter's vendor-specific plan-row type.
```

The standalone equivalent is `explain(readQuery, db.adapter, options)`.
Qubu calls the adapter's `explain()` method rather than `execute()`.

Qubu keeps `ExplainResult.rows` in the adapter's vendor-specific shape. It
does not normalize PostgreSQL, SQLite, or MySQL plans into one tree. The
adapter owns parameter binding, plan-row decoding, connections, transactions,
and cancellation. `ExplainRequest` carries the rendered statement, ordered
raw parameters, query kind, and optional abort signal just like an ordinary
execution request.

The first-party policies accept these options:

| Dialect    | Plan options                                                                       | Restrictions                                                      |
| ---------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| PostgreSQL | `analyze`, `verbose`, `buffers`, and `format: 'text' \| 'xml' \| 'json' \| 'yaml'` | `buffers` requires `analyze`; analysis requires a read query kind |
| SQLite     | `format: 'query-plan' \| 'bytecode'` or `queryPlan`                                | `analyze`, `verbose`, and `buffers` are unsupported               |
| MySQL      | `analyze` or `format: 'traditional' \| 'json' \| 'tree'`                           | `analyze` cannot be combined with `format`; requires a read query kind |

All supported queries can be explained, including `INSERT`, `UPDATE`, and
`DELETE`. Mutation EXPLAIN is always plan-only. The type and runtime
boundaries reject `analyze` for mutation query kinds. Analysis executes the
read statement; Qubu does not parse SQL or rule out side effects from routines,
custom fragments, or data-modifying SQL hidden inside it. Unsupported options
and invalid combinations raise a structured `QueryValidationError` before the
adapter is called.
