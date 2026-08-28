# Troubleshooting

> Start from the observed error or output, verify the boundary that produced it, and apply the smallest fix that changes the result.

## Column is not available in this query scope

Qubu found a column whose source is not in `FROM` or `JOIN` clauses.
Read [Source scope](query-model/source-scope.md) for the source
identity rules behind this error.

Check that the query includes the original source or use the columns exposed by
the alias, CTE, or derived table you actually placed in the query:

```ts
import { alias, from, select } from "qubu"

const author = alias(users, "author")

select({ name: author.name }, from(author))
```

`author.name` is valid in this query; `users.name` is a different source
identity after aliasing.

## UPDATE/DELETE requires a WHERE

This is the default mutation safety check. Add a source-aware predicate:

```ts
import { deleteFrom, eq, update, where } from "qubu"

update(users, { name: "Ada" }, where(eq(users.id, 7)))
deleteFrom(users, where(eq(users.id, 8)))
```

If every row is intentionally affected, pass `allowAll()` explicitly and keep
that decision close to the authorization or maintenance code that justifies
it.

## scalar() requires one selected column

A scalar subquery must return one selected field. Reduce the projection before
calling `scalar()`:

```ts
import { from, scalar, select } from "qubu"

const idQuery = select({ id: users.id }, from(users))
const idExpression = scalar(idQuery)
```

Use a normal derived table or CTE when the nested query needs multiple fields.
For scalar result nullability, see [Result shapes and cardinality](query-model/result-shapes.md).

## Placeholders do not match the driver

Render with the dialect that the adapter expects and inspect both fields of the
result:

```ts
import { render } from "qubu"
import { postgresDialect } from "qubu/postgres"

const statement = render(query, postgresDialect())
console.log(statement.text)
console.log(statement.parameters)
```

`statement.parameters` is ordered to match the placeholders in `statement.text`.
Do not interpolate the values into the text or use a PostgreSQL dialect with a
driver that expects `?` placeholders.

## Read and repair query diagnostics

Type-level query failures carry stable properties in the diagnostic type, and
runtime authoring failures throw `QueryValidationError`. Read the code, context,
path, and hint before changing the query. The hint names the repair boundary;
the path points to the clause or field that needs attention.

```ts
import { QueryValidationError, fetchFirst } from "qubu"

try {
  fetchFirst(-1)
} catch (error) {
  if (error instanceof QueryValidationError) {
    console.error(error.code, error.context, error.path, error.hint)
  }
}
```

TypeScript diagnostics expose the same names through `QueryTypeValidation`:
`__qubu_error_code__`, `__qubu_error_context__`, and
`__qubu_error_hint__`. Treat those fields as the repair contract. Do not cast
away a failed query type just to reach rendering.

| Code                         | Usual repair                                                                 |
| ---------------------------- | ---------------------------------------------------------------------------- |
| `invalid-selection`          | Give `select()` at least one valid projected field.                          |
| `duplicate-clause`           | Keep one instance of a clause that Qubu allows only once.                    |
| `invalid-mutation`           | Fix the mutation shape before rendering it.                                  |
| `unsafe-mutation`            | Add `where(...)` or opt into `allowAll()` deliberately.                      |
| `invalid-update`             | Use target-table columns and valid assignment values.                        |
| `invalid-insert`             | Supply required target columns and no unknown columns.                       |
| `invalid-comparison`         | Use operands with compatible nullability or SQL domains.                     |
| `invalid-boolean-expression` | Pass a boolean expression to `where()`, `having()`, or boolean operators.    |
| `invalid-pagination`         | Pass a non-negative integer to `offset()`, `fetchFirst()`, or `fetchNext()`. |
| `invalid-json-path`          | Use string object keys and non-negative integer array indexes.               |
| `missing-source`             | Add the owning source with `from()`, a join, or intentional `correlate()`.   |
| `invalid-grouping`           | Group visible dependencies or project them through an aggregate.             |
| `incompatible-sql-domain`    | Use an expression with the required SQL capability.                          |
| `incompatible-sql-equality`  | Compare values from the same SQL equality group.                             |
| `incompatible-sql-order`     | Compare or order values from the same SQL ordering group.                    |
| `incompatible-set-domain`    | Make corresponding set-operation fields use compatible domains.              |
| `invalid-subquery`           | Give `scalar()` or `inQuery()` the required field count and shape.           |
| `invalid-omission`           | Use `omit` only for a conditional projection or supported query clause.      |
| `missing-dialect-capability` | Render with a dialect that advertises the query's required capability.       |

After the smallest source or clause fix, run the type check again, then render
the query with the adapter's dialect and inspect `text` and `parameters`
together.

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
import { eq, fetchFirst, from, render, select, where } from "qubu"

const statement = render(
  select({ id: users.id }, from(users), where(eq(users.id, 7)), fetchFirst(10)),
)
```

The `WHERE` parameter renders before the pagination parameter because the SQL
text places `WHERE` before pagination.
