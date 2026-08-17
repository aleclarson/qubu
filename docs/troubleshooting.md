# Troubleshooting

> Start from the observed error or output, verify the boundary that produced it, and apply the smallest fix that changes the result.

## “The column is not available in this query scope”

Qubu found a column whose source is not in `FROM` or `JOIN` clauses.

Check that the query includes the original source or use the columns exposed by
the alias, CTE, or derived table you actually placed in the query:

```ts
const author = alias(users, 'author')

select({ name: author.name }, from(author))
```

`author.name` is valid in this query; `users.name` is a different source
identity after aliasing.

## “UPDATE/DELETE requires a WHERE”

This is the default mutation safety check. Add a source-aware predicate:

```ts
update(users, { name: 'Ada' }, where(eq(users.id, 7)))
deleteFrom(users, where(eq(users.id, 8)))
```

If every row is intentionally affected, pass `allowAll()` explicitly and keep
that decision close to the authorization or maintenance code that justifies
it.

## “scalar() requires a query with exactly one selected column”

A scalar subquery must return one selected field. Reduce the projection before
calling `scalar()`:

```ts
const idQuery = select({ id: users.id }, from(users))
const idExpression = scalar(idQuery)
```

Use a normal derived table or CTE when the nested query needs multiple fields.

## Placeholders do not match the driver

Render with the dialect that the adapter expects and inspect both fields of the
result:

```ts
const statement = render(query, postgresDialect())
console.log(statement.text)
console.log(statement.parameters)
```

`statement.parameters` is ordered to match the placeholders in `statement.text`.
Do not interpolate the values into the text or use a PostgreSQL dialect with a
driver that expects `?` placeholders.

## A Vite global is undefined or missing from TypeScript

Verify all three opt-ins:

1. The Vite config includes `qubu()` from `qubu/vite`.
2. The source module starts its directive prologue with `'use qubu'` (after any
   other directive is also supported).
3. TypeScript includes `qubu/globals` in its `types` list or includes the
   declaration explicitly.

The transform skips non-script files, dependencies under `node_modules`, files
excluded by filters, and modules that reference no eligible Qubu global.

## Parameters are in an unexpected order

`select()` accepts clauses as independent values and normalizes their SQL
placement. Rendering traverses that normalized statement, so inspect the final
`text` and `parameters` together rather than assuming source argument order:

```ts
const statement = render(
  select({ id: users.id }, fetchFirst(10), where(eq(users.id, 7)), from(users))
)
```

The `WHERE` parameter renders before the pagination parameter because the SQL
text places `WHERE` before pagination.
