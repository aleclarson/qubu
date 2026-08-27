# Compose queries

> Reuse a query's inferred row shape as a typed source for CTEs, derived tables, subqueries, and set operations.

## Turn a query into a CTE

`cte()` exposes the selected fields of a query as columns on a new source.
Attach it with `withCte()` and use the CTE source in `from()`:

```ts
import {
  cte,
  eq,
  from,
  integer,
  select,
  table,
  text,
  where,
  withCte,
} from 'qubu'

const users = table('users', {
  id: integer(),
  name: text(),
})

const activeUsers = cte(
  'active_users',
  select(
    { id: users.id, name: users.name },
    from(users),
    where(eq(users.id, 7))
  )
)

const report = select(
  { displayName: activeUsers.name },
  withCte(activeUsers),
  from(activeUsers)
)
```

`activeUsers.name` is a typed column derived from the first query's row shape.
The rendered statement includes the `WITH` clause before `SELECT`. Selected
camelCase keys use snake_case while they belong to the CTE relation; the outer
result projection aliases them back to camelCase for the returned row.

## Build a recursive CTE

`recursiveCte()` uses the anchor projection as the contract for a recursive
member. The callback receives a typed self-reference; introduce it through
`from()` or a join before selecting its fields:

```ts
import {
  add,
  cast,
  from,
  integer,
  lt,
  recursiveCte,
  select,
  value,
  where,
  withCte,
} from 'qubu'

const numbers = recursiveCte(
  'numbers',
  select({ value: cast(value(1), integer()) }),
  self =>
    select({ value: add(self.value, 1) }, from(self), where(lt(self.value, 3)))
)

const query = select({ value: numbers.value }, withCte(numbers), from(numbers))
```

The anchor names the fields, application types, nullability, and SQL domains
that the returned source exposes. The member must project those same fields
with compatible types. Give bound anchor values an explicit SQL type with
`cast()` when the database cannot infer it from surrounding columns; PostgreSQL
requires this for recursive CTE anchors. Qubu renders `WITH RECURSIVE`, an
explicit relation column list, and `anchor UNION ALL member`; ordinary and
recursive CTEs can share one `withCte()` clause.

## Use a derived table

Alias a query when it should be used as an inline source:

```ts
import { alias, from, lower, select } from 'qubu'
import type { SqlTypeOf } from 'qubu'

const names = select({ name: lower(users.name) }, from(users))
const namesSource = alias(names, 'names')

const query = select({ name: namesSource.name }, from(namesSource))
type NameSqlDomain = SqlTypeOf<typeof namesSource.name>
// SqlText
```

The alias gets the selected query's fields, while the new source identity keeps
scope checks from confusing `namesSource.name` with `users.name`.

Its SQL domain is retained too. The projected `lower(users.name)` remains
`SqlText` through this query alias, and the same preservation applies to a CTE,
so downstream text operations remain checked without redeclaring the field.

## Nest a scalar subquery

`scalar()` turns a query with exactly one selected field into an expression:

```ts
import { from, scalar, select, value } from 'qubu'

const firstId = select({ id: users.id }, from(users))
const query = select(
  {
    name: users.name,
    firstId: scalar(firstId),
  },
  from(users)
)
```

`scalar()` throws at runtime when the query selects more than one field. Its
type is the selected field's value type, widened with `null` when the query may
return no rows. An ordinary select and `fetchFirst(1)` are both nullable: the
limit proves at most one row, not that a row exists. A source-free select such
as `select({ value: value(42) })` is known to produce exactly one row.

Qubu does not treat an arbitrary predicate as proof of exactness. Use
`exists()`, `notExists()`, or `inQuery()` for boolean subquery predicates.

## Combine compatible queries

Set operations preserve the left query's row shape. Both queries must select
compatible rows:

```ts
import { eq, from, select, unionAll, where } from 'qubu'

const first = select({ id: users.id }, from(users))
const second = select({ id: users.id }, from(users), where(eq(users.id, 7)))

const allUsers = unionAll(first, second)
```

Use `union`, `unionAll`, `intersect`, or `except` depending on the SQL
operation. Each input renderer still contributes its runtime parameters, which
are collected in traversal order.

## Prefer values over a builder chain

Build reusable pieces as ordinary values and pass them into the final query:

```ts
import { desc, eq, from, orderBy, select, where } from 'qubu'

const byId = where(eq(users.id, 7))
const newest = orderBy(desc(users.id))

const query = select(
  { id: users.id, name: users.name },
  from(users),
  byId,
  newest
)
```

This makes it possible to share a predicate or projection without mutating a
query object. The final `select()` call remains the place where source scope
and result shape are checked. Qubu also accepts these independent values in
another order, but SQL order is the canonical visual style for finished query
code.

## Constrain a reusable fragment by required fields

Use `TableLike` when a fragment requires a physical table and `SourceLike`
when aliases, CTEs, derived tables, or custom sources are also valid. Both are
lower-bound constraints: the source may contain additional fields, and the
generic function retains its exact source identity.

For an application-level requirement, describe the required JavaScript row:

```ts
import { eq, where } from 'qubu'
import type { TableLike } from 'qubu'

function byStringId<TTable extends TableLike<{ id: string }>>(
  table: TTable,
  id: string
) {
  return where(eq(table.columns.id, id))
}
```

`{ id: string }` means a non-null selected string. It accepts a table with
extra fields and rejects `string | null`, but it does not distinguish
`SqlText` from `SqlUuid` because both have a JavaScript output of `string`.

Use `FieldLike` when the fragment depends on SQL semantics:

```ts
import { eq, where } from 'qubu'
import type { FieldLike, SourceLike, SqlTextLike } from 'qubu'

type NonNullTextId = FieldLike<{
  sqlType: SqlTextLike
  nullable: false
}>

function byTextId<TSource extends SourceLike<{ id: NonNullTextId }>>(
  source: TSource,
  id: string
) {
  return where(eq(source.columns.id, id))
}
```

This version accepts known text-like and permissive `SqlUnknown` fields. It
rejects nullable text and known non-text domains such as `SqlUuid`. Add an
`output` property to the `FieldLike` descriptor when the fragment also needs a
specific JavaScript result type.
