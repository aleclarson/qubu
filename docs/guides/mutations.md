# Write mutations

> Build typed `INSERT`, `UPDATE`, and `DELETE` statements from the same table metadata while keeping destructive operations explicit.

## Define write-time rules

Generated and default columns affect which input fields are required. Nullable
columns accept `null` as a value, which is distinct from omitting a defaulted
field:

```ts
import { integer, table, text } from 'qubu'

const users = table('users', {
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
import { insertInto, render, returning, values } from 'qubu'

const query = insertInto(
  users,
  values(
    { name: 'Ada', email: null },
    { name: 'Grace', email: 'grace@example.com' }
  ),
  returning({ id: users.id, name: users.name })
)

render(query)
// {
//   text: 'INSERT INTO "users" ("name", "email") VALUES (?, ?), (?, ?) RETURNING "users"."id" AS "id", "users"."name" AS "name"',
//   parameters: ['Ada', null, 'Grace', 'grace@example.com'],
// }
```

Use `defaultValues()` only when every non-generated column has a database
default. Use `insertSelect(query, columns)` for an `INSERT ... SELECT` source.

## Update with a predicate

`UPDATE` assignments accept either application values or expressions built from
the target table:

```ts
import { eq, returning, update, upper, where } from 'qubu'

const query = update(
  users,
  { name: upper(users.name) },
  where(eq(users.id, 7)),
  returning({ id: users.id, name: users.name })
)
```

The assignment expression is source-aware, so a column from an unrelated table
cannot silently enter the update.

Use `omit` for a runtime-conditional assignment. Qubu removes omitted fields
before validating and rendering the effective assignment set:

```ts
import { eq, omit, update, where } from 'qubu'

const query = update(
  users,
  {
    name: rename ? 'Archived' : omit,
    email: clearEmail ? null : omit,
  },
  where(eq(users.id, 7))
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
import { deleteFrom, eq, returning, where } from 'qubu'

const query = deleteFrom(
  users,
  where(eq(users.id, 8)),
  returning({ id: users.id })
)
```

`deleteFrom()` is also exported as `removeFrom()`.

## Keep unrestricted writes explicit

Both `UPDATE` and `DELETE` require a `WHERE` clause by default. If an operation
really must affect every row, opt in at the call site:

```ts
import { allowAll, update } from 'qubu'

const query = update(users, { name: 'Archived' }, allowAll())
```

`allowAll()` is a safety boundary, not a replacement for authorization or
application-level confirmation. Keep it close to the code that proves the
unrestricted operation is intended.

## Return typed rows

`returning()` uses the same named object projection as `SELECT`. Use
`{ ...all(table) }` when every table column should be returned. When present,
the mutation's `row` type is inferred from that projection, so an adapter can
return the affected rows with the same shape as a read query.

See [Schema and type metadata](../concepts/schema-and-types.md) for custom
output, insert, and update types, then [Dialects and execution](../concepts/dialects-and-execution.md)
for the driver boundary.
