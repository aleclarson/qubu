# Add sources and clauses

> Publish a custom SQL clause or relation while preserving parameter order and source-scope checks.

## Add a custom clause

Qubu extensions are ordinary fragments. A custom clause supplies a placement,
render order, and renderer:

```ts
import { from, render, select, table, text } from 'qubu'
import { customClause } from 'qubu/core'

const users = table('users', { name: text() })

const fetchWithTies = customClause({
  name: 'fetch-with-ties',
  order: 100,
  render(context) {
    context.append('FETCH FIRST ')
    context.parameter(10)
    context.append(' ROWS WITH TIES')
  },
})

const query = select({ name: users.name }, from(users), fetchWithTies)

render(query)
// ... FETCH FIRST ? ROWS WITH TIES
```

`context.parameter(10)` binds the value at render time, and the rendered
parameter is still ordered with every other parameter in the query. Parameter
value types are intentionally not part of fragment metadata.

## Add a typed custom FROM source

Use `customSource()` for a table-valued function or another relation whose row
shape is known to the application but cannot be declared with `table()`. Its
`columns` definitions create the same direct and `.columns` references as a
table, while `from()` or a join supplies the source to the query scope:

```ts
import { from, integer, render, select, text } from 'qubu'
import { identifier } from 'qubu/core'
import { customSource } from 'qubu/schema'

const rows = customSource({
  identity: { sourceKind: 'table-function', name: 'json_each', alias: 'row' },
  sourceKind: 'table-function',
  reference: identifier('row'),
  columns: {
    key: integer(),
    value: text({ nullable: true }),
  },
  render(context) {
    context.append('json_each(')
    context.parameter('{"a":1}')
    context.append(') AS ')
    context.render(identifier('row'))
  },
})

const query = select({ value: rows.value }, from(rows))
render(query)
// ... FROM json_each(?) AS "row"
```

`identity` is the source-scope key; `reference` is the SQL qualifier used by
the generated columns. A nullable column remains nullable intrinsically, and a
`leftJoin(rows, ...)` adds outer-join nullability to every selected row
column. Render the complete relation in the producer and bind values with
`context.parameter()`; the normal renderer preserves parameter order.

## Read next

- [Add typed expressions](typed-expressions.md) covers custom SQL domains and
  metadata-preserving expression wrappers.
- [Add a dialect policy](dialects.md) covers identifier, placeholder, and
  pagination policies.
- [Source scope](../../query-model/source-scope.md) explains the identity rules
  custom sources must satisfy.
