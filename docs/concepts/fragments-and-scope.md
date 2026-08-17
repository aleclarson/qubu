# Fragments and source scope

> Understand the small value model behind Qubu and use compiler feedback to catch columns that are outside a query's relational scope.

## A query is composed from fragments

The runtime unit is a `Fragment` with a renderer and type metadata:

```ts
Fragment<Output, RequiredSources, Parameters>
```

The renderer appends SQL and parameters to a context. The generic arguments
carry the consequences that later composition needs:

- `Output` describes the value or row produced by the fragment.
- `RequiredSources` identifies tables, aliases, CTEs, or derived queries that
  must be available before the fragment is valid.
- `Parameters` describes the value types that may be bound while rendering.

This keeps the runtime core small. Qubu does not require extensions to build or
register nodes in a central mutable AST.

```mermaid
flowchart LR
  A["table('users', ...) "] --> B["users.id"]
  B --> C["eq(users.id, 7)"]
  C --> D["where(...)"]
  D --> E["select(...)"]
  E --> F["render(query)"]
```

## Source requirements accumulate

A table column remembers the source that provides it. The projection, each
clause, and each nested expression contributes its required sources to the
query's scope. A missing source is therefore reported at composition time:

```ts
import { from, integer, select, table } from 'qubu'

const users = table('users', {
  id: integer(),
})
const posts = table('posts', {
  id: integer(),
})

select({ id: users.id }, from(posts))
// Type error: users is not available in this query scope
```

Add the source that owns the column, or join it with a predicate that refers to
both sources:

```ts
import { eq, from, innerJoin, integer, select, table } from 'qubu'

const users = table('users', {
  id: integer(),
})
const posts = table('posts', {
  id: integer(),
  authorId: integer(),
})

const query = select(
  { userId: users.id, postId: posts.id },
  from(users),
  innerJoin(posts, eq(users.id, posts.authorId))
)
```

Aliases, CTEs, and derived queries expose new source identities. Use the
exposed columns from the new source rather than continuing to use columns from
the source that was wrapped.

## Output shape is part of composition

An object projection names the row fields directly. An aliased expression adds
the alias to the result shape:

```ts
import {
  aliasExpression,
  from,
  integer,
  select,
  table,
  text,
  upper,
} from 'qubu'

const users = table('users', {
  id: integer(),
  name: text(),
})

const query = select(
  {
    id: users.id,
    displayName: aliasExpression(upper(users.name), 'displayName'),
  },
  from(users)
)

type Row = typeof query.row
// { id: number; displayName: string }
```

That row shape becomes the public column surface when the query is used as a
derived table or CTE. The same selection can also be reused in `RETURNING`.

## Compile-time parameters and runtime order

Composed fragments expose the union of their accepted parameter value types.
The type contract answers “which kinds of values can this query bind?” It does
not claim an ordered tuple.

Rendering remains the authority for order:

```ts
import {
  and,
  eq,
  from,
  integer,
  like,
  render,
  select,
  table,
  text,
  where,
} from 'qubu'

const users = table('users', {
  id: integer(),
  name: text(),
})

const query = select(
  { id: users.id },
  from(users),
  where(and(eq(users.id, 7), like(users.name, '%Ada%')))
)

render(query)
// text:       ... WHERE (("users"."id" = ?) AND ("users"."name" LIKE ?))
// parameters: [7, '%Ada%']
```

The `parameters` array follows the placeholders in `text`, even when clauses
were passed to `select()` in a different order.

## Keep the boundary explicit

The type system focuses on high-value relational facts: source scope, selected
fields, nullability, and parameter types. It does not attempt to encode every
vendor-specific grammar rule. Use the standard fragments for portable SQL and
move intentional divergence to [dialects or custom extensions](dialects-and-execution.md).
