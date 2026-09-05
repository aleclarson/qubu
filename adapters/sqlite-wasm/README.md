# `@qubu/adapter-sqlite-wasm`

> Adapt a database from the official SQLite WASM OO1 API to Qubu's
> `QueryAdapter` boundary, including in a dedicated browser worker.

Initialize the official SQLite module in the runtime that owns the database,
then pass its OO1 database handle to `sqliteWasmAdapter`:

```ts
import sqlite3InitModule from "@sqlite.org/sqlite-wasm"
import { sqliteWasmAdapter } from "@qubu/adapter-sqlite-wasm"
import { qubu } from "qubu"

const sqlite3 = await sqlite3InitModule()
const database = new sqlite3.oo1.DB(":memory:")
const adapter = sqliteWasmAdapter(database)
const db = qubu(adapter)

try {
  // Use db.execute(), db.rows(), or db.explain() here.
} finally {
  adapter.close()
}
```

The adapter prepares each rendered statement, binds Qubu's parameters in
placeholder order, reads object rows, and finalizes the statement in a
`finally` block. Mutations report SQLite's change count and include `RETURNING`
rows when the statement has result columns. Use `SqliteWasmAdapterOptions.encoder`
for application values that need conversion before SQLite binds them.

The package does not create a worker for you. In a browser application, place
the module initialization and adapter in a dedicated `Worker`, call
`adapter.close()` before the worker exits, and terminate the worker from its
owner. The official package's `sqlite3.wasm` asset must be served beside the
bundled worker module.

## Limitations

- No callback transactions, streaming, or migration adapter is exposed.
- Database execution is synchronous and blocks its owning thread. Abort signals
  are checked before preparation but cannot interrupt an executing statement.
- Mutations expose `affectedRows`, but no generated `insertId`. Use `RETURNING`
  when you need inserted keys.
- Worker creation, WASM initialization, asset serving, and storage configuration
  belong to the application. The adapter accepts an initialized OO1 database;
  it does not provide a worker messaging protocol or configure persistent storage.
