# Source scope

> Keep each column tied to the table, alias, CTE, or derived source that provides it; use this page to fix scope errors and intentional correlations.

A column carries the identity of the source that provides it. Qubu checks that
identity when you assemble a query. The source must appear in `FROM` or a join
before its columns can appear in the projection, a predicate, or another
clause.

## Add the source that owns a column

Qubu reports a missing source when a query selects a column from a table that
does not appear in the query:

```ts
import { from, integer, select, table, text } from 'qubu'

const users = table('users', {
  id: integer(),
})
const posts = table('posts', {
  id: integer(),
  title: text(),
})

select({ id: users.id }, from(posts))
// Type error: users is not available in this query scope
```

Add the source that owns the column, or join it with a condition that refers to
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

## Use the source identity you introduced

Aliases, CTEs, derived queries, and custom sources expose new source identities.
Use their columns after wrapping the original source:

```ts
import { alias, from, integer, select, table, text } from 'qubu'

const users = table('users', {
  id: integer(),
  name: text(),
})

const author = alias(users, 'author')
const query = select({ name: author.name }, from(author))
```

`author.name` belongs to the `author` source. `users.name` is a different source
identity after aliasing, even though both columns refer to the same table.

The same rule applies to a CTE or derived query. A query's selected row becomes
the set of columns exposed by its new source:

```ts
import { alias, from, lower, select } from 'qubu'

const names = select({ name: lower(users.name) }, from(users))
const namesSource = alias(names, 'names')

const query = select({ name: namesSource.name }, from(namesSource))
```

Use [Compose queries](../../guides/compose-queries.md) for the full CTE,
derived-table, scalar-subquery, and set-operation workflow.

## Produce a custom FROM source

Use `customSource()` for a table-valued function or another relation that
`table()` cannot describe. The producer supplies the source identity, column
definitions, and complete relation renderer:

```ts
import {
  customSource,
  eq,
  from,
  identifier,
  integer,
  select,
  text,
  where,
} from 'qubu'

const entries = customSource({
  identity: {
    sourceKind: 'table-function',
    name: 'json_each',
    alias: 'entry',
  },
  sourceKind: 'table-function',
  reference: identifier('entry'),
  columns: {
    key: integer(),
    value: text({ nullable: true }),
  },
  render(context) {
    context.append('json_each(')
    context.parameter('{"a":1}')
    context.append(') AS ')
    context.render(identifier('entry'))
  },
})

const query = select(
  { value: entries.value },
  from(entries),
  where(eq(entries.key, 7))
)
```

`identity` is the type-level source key. `reference` is the SQL qualifier used
by the generated columns. The nullable `value` column stays nullable, and a
`leftJoin()` adds outer-join nullability to every selected column from
`entries`.

Bind function arguments with `context.parameter()`. The normal renderer then
keeps those values in placeholder order.

## Correlate an inner query

Use `correlate()` when an inner query intentionally reads a source from its
enclosing query. The provision changes type checking but emits no SQL:

```ts
import {
  correlate,
  crossJoin,
  eq,
  from,
  integer,
  lateral,
  select,
  table,
  where,
} from 'qubu'

const users = table('users', { id: integer() })
const posts = table('posts', {
  id: integer(),
  authorId: integer(),
})

const recentPost = select(
  { id: posts.id },
  from(posts),
  correlate(users),
  where(eq(posts.authorId, users.id))
)

const recent = lateral(recentPost, 'recent_post')
const query = select(
  { userId: users.id, postId: recent.id },
  from(users),
  crossJoin(recent)
)
```

The inner query consumes `posts` locally. The enclosing `users` source satisfies
its outer requirement. The same requirement flows through `scalar()`,
`exists()`, and `inQuery()`.

## Read next

- [Result shapes and cardinality](result-shapes.md) explains projection names,
  outer-join nullability, and scalar subqueries.
- [Fragments and metadata](fragments.md) explains the type facts that carry
  source requirements through custom expressions and clauses.
- [Extend Qubu](../../guides/extensions.md) shows how to publish a custom
  source or clause.
