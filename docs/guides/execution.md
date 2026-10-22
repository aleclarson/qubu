# Execute queries

> Bind an adapter, return typed rows or mutation facts, and choose additional capabilities when needed.

## Choose an adapter and execute

Install the adapter beside its database driver. For PostgreSQL with `pg`:

```sh
pnpm add qubu @qubu/adapter-pg pg
```

```ts
import { from, integer, qubu, select, table, text } from "qubu"
import { pgAdapter } from "@qubu/adapter-pg"
import { Pool } from "pg"

const pool = new Pool() // Uses pg's connection configuration.
const db = qubu(pgAdapter(pool))
const users = table("users", { id: integer(), name: text() })
const readQuery = select({ id: users.id, name: users.name }, from(users))

const rows = await db.rows(readQuery)
// readonly { id: number; name: string }[]
```

The table must already exist. `table()` describes it; it does not create it.
The application owns the pool and closes it when finished.

For another driver, choose its adapter package and follow its README. An
adapter determines the default rendering dialect and available capabilities;
[adapter implementation and dialect policy](../dialects-and-execution.md)
belong at that boundary.

## Choose rows or a result envelope

The bound client exposes its adapter as `db.adapter`. Pass cancellation and
rendering options per call:

```ts
const controller = new AbortController()
const result = await db.execute(readQuery, {
  signal: controller.signal,
})

result.rows
result.affectedRows
```

`db.execute()` returns the structured result. Mutations can include optional
`affectedRows`, `changedRows`, and `insertId` facts; Qubu does not derive them
from returned rows. `db.rows()` returns only its row array. Both methods infer
each row from the query projection. They do not make
query values executable or transfer connection ownership to Qubu.

## Execute without a bound client

The standalone functions remain useful when the adapter varies by call or a
small module does not need a bound client:

```ts
import { execute, executeRows } from "qubu"

const result = await execute(readQuery, db.adapter)
const rows = await executeRows(readQuery, db.adapter)
```

## Add only the capability the task needs

- [Transactions](transactions.md): scoped writes, savepoints, and locking reads.
- [Streaming](streaming.md): incremental reads and cursor cleanup.
- [Query plans](explain.md): vendor EXPLAIN rows and analysis for read query kinds.
- [Lifecycle hooks](hooks.md): observations on bound clients and their scopes.
- [Result decoding](../dialects-and-execution.md#decode-schema-aware-result-values): driver-specific values and field overrides.

Execution renders the query each time. In particular, runtime insert defaults
are evaluated again; see [runtime defaults](../schema/columns-and-writes.md#supply-defaults-at-runtime).
