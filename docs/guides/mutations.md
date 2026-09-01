# Write mutations

> Build typed `INSERT`, `UPDATE`, and `DELETE` statements from the same table metadata while keeping destructive operations explicit.

## Define write-time rules

Generated and default columns affect which input fields are required. Nullable
columns accept `null` as a value, which is distinct from omitting a defaulted
field:

```ts
import { integer, table, text } from "qubu"

const users = table("users", {
  id: integer({ generated: true }),
  name: text(),
  email: text({ nullable: true, hasDefault: true }),
})
```

The generated `id` is omitted from inserts and updates. `email` is optional on
insert, but `{ email: null }` explicitly writes `NULL` when supplied.

## Insert rows

Pass one or more rows to `values()`. Qubu checks that every row uses the same
columns and that required, non-generated fields are present:

```ts
import { insertInto, render, returning, values } from "qubu"

const query = insertInto(
  users,
  values({ name: "Ada", email: null }, { name: "Grace", email: "grace@example.com" }),
  returning({ id: users.id, name: users.name }),
)

render(query)
// {
//   text: 'INSERT INTO "users" ("name", "email") VALUES (?, ?), (?, ?) RETURNING "users"."id" AS "id", "users"."name" AS "name"',
//   parameters: ['Ada', null, 'Grace', 'grace@example.com'],
// }
```

Use `defaultValues()` only when every non-generated column has a database
default. Use `insertSelect(query, columns)` for an `INSERT ... SELECT` source.
An ordinary or recursive `withCte()` clause can prefix any mutation; see
[Compose queries](compose-queries.md#turn-a-query-into-a-cte) for the typed
`WITH ... INSERT`, `WITH ... UPDATE`, and `WITH ... DELETE` patterns.

Each field may also be a typed expression whose output is compatible with the
target column. Expressions render directly and retain their dialect
requirements; ordinary application values still pass through the column's
parameter encoder:

```ts
import { upper } from "qubu"

insertInto(users, values({ name: upper("Ada") }))
```

An `INSERT ... VALUES` row does not introduce a relational source, so its
expressions cannot reference columns from the target table or another table.
Use `insertSelect()` when inserted values need a query source.

## Resolve PostgreSQL conflicts

PostgreSQL upserts can target a primary key, a `unique()` constraint, or a
declared unique index from the inserted table. A partial unique index carries
its predicate into the conflict target so PostgreSQL can infer the same index:

```ts
import { boolean, eq, index, table, text, value } from "qubu"
import { doUpdate, excluded, onConflict } from "qubu/postgres"

const accounts = table(
  "accounts",
  { email: text(), active: boolean(), name: text() },
  (accounts) => ({
    constraints: {},
    indexes: {
      activeEmail: index([accounts.email], {
        unique: true,
        where: eq(accounts.active, value(true)),
        dialect: { dialect: "postgresql" },
      }),
    },
  }),
)

const incoming = excluded(accounts)
const conflict = onConflict(
  accounts,
  accounts.indexes.activeEmail,
  doUpdate({ name: incoming.name }),
)
```

The index must be unique, declared on the insert target, and portable or marked
for PostgreSQL. Index expressions and predicates use the same deterministic,
parameter-free schema-expression rules as the declared index. Constraint-based
targets keep their existing cross-dialect behavior; unique-index inference is
PostgreSQL-specific.

## Update with a predicate

`UPDATE` assignments accept either application values or expressions built from
the target table:

```ts
import { eq, returning, update, upper, where } from "qubu"

const query = update(
  users,
  { name: upper(users.name) },
  where(eq(users.id, 7)),
  returning({ id: users.id, name: users.name }),
)
```

The assignment expression is source-aware, so a column from an unrelated table
cannot silently enter the update.

PostgreSQL updates can introduce one or more typed sources with `updateFrom()`.
Those sources are available to assignments, the predicate, and `RETURNING`:

```ts
import { eq, integer, render, returning, table, text, update, where } from "qubu"
import { postgresDialect, updateFrom } from "qubu/postgres"

const changes = table("user_changes", {
  userId: integer(),
  name: text(),
})

const query = update(
  users,
  { name: changes.name },
  updateFrom(changes),
  where(eq(users.id, changes.userId)),
  returning({ id: users.id, sourceName: changes.name }),
)

render(query, postgresDialect())
// UPDATE "users" SET "name" = "user_changes"."name"
// FROM "user_changes"
// WHERE ("users"."id" = "user_changes"."user_id")
// RETURNING "users"."id" AS "id", "user_changes"."name" AS "sourceName"
```

`UPDATE ... FROM` carries a dialect capability requirement, so rendering it
with the default, SQLite, or MySQL dialect is rejected. Qubu still requires a
predicate or an explicit `allowAll()` marker; introducing a source does not
authorize an unrestricted update.

Use `omit` for a runtime-conditional assignment. Qubu removes omitted fields
before validating and rendering the effective assignment set:

```ts
import { eq, omit, update, where } from "qubu"

const query = update(
  users,
  {
    name: rename ? "Archived" : omit,
    email: clearEmail ? null : omit,
  },
  where(eq(users.id, 7)),
)
```

`omit` means that the column is absent from `SET`. It is distinct from `null`
and explicit `undefined`, which remain bound assignment values, and it does not
emit SQL `DEFAULT`. At least one assignment must remain; `update()` throws
before rendering when every field is omitted. Possible expression branches
remain source- and capability-aware even when their runtime alternative is
`omit`.

## Delete with a predicate

```ts
import { deleteFrom, eq, returning, where } from "qubu"

const query = deleteFrom(users, where(eq(users.id, 8)), returning({ id: users.id }))
```

## Keep unrestricted writes explicit

Both `UPDATE` and `DELETE` require a `WHERE` clause by default. If an operation
really must affect every row, opt in at the call site:

```ts
import { allowAll, update } from "qubu"

const query = update(users, { name: "Archived" }, allowAll())
```

`allowAll()` is a safety boundary, not a replacement for authorization or
application-level confirmation. Keep it close to the code that proves the
unrestricted operation is intended.

## Return typed rows

`returning()` uses the same named object projection as `SELECT`. Reserve
`{ ...all(table) }` for the intentional contract of returning every table
column. When present, the mutation's `row` type is inferred from that projection, so
`(await db.execute(query)).rows` has the same shape as a read query when `db`
comes from `qubu(adapter)`. The projection's SQL semantic domains are
retained too, so a returned query used by typed composition does not collapse
UUID, text, numeric, or other known fields to their JavaScript types alone.

`db.execute()` and the standalone `execute()` function also return optional
`affectedRows`, `changedRows`, and `insertId` facts supplied by the adapter. Use
`db.rows()` or `executeRows()` when only the returned rows matter. The
[execution guide](../dialects-and-execution.md) defines which driver facts
belong in each field.

See [Column behavior and write types](../schema/columns-and-writes.md)
for custom output, insert, and update types, then [Dialects and execution](../dialects-and-execution.md)
for the driver boundary.
