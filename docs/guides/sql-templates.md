# Compose SQL templates

> Use trusted SQL syntax with bound runtime values while retaining the Qubu metadata carried by interpolated expressions, fragments, and queries.

## Bind every runtime value

The `sql` tag treats template text as SQL syntax and every ordinary
substitution as a parameter. This includes strings, numbers, objects, arrays,
and `null`:

```ts
import { integer, render, sql, table, text } from "qubu"

const users = table("users", { name: text() })
const posts = table("posts", { id: integer() })
const search = "Ada%"
const predicate = sql`${users.name} LIKE ${search}`

render(predicate)
// {
//   text: '"users"."name" LIKE ?',
//   parameters: ['Ada%'],
// }
```

`${users.name}` is a Qubu expression, so the tag renders its quoted column
reference. `${search}` is an ordinary value, so it cannot become SQL text.

## Compose expressions, templates, and queries

Fragment substitutions use the same rendering context as the enclosing
statement. Parameters keep one placeholder sequence across nested templates
and queries:

```ts
import { eq, from, render, select, sql, where } from "qubu"
import { postgresDialect } from "qubu/postgres"

const selectedNames = select({ displayName: users.name }, from(users), where(eq(users.name, "Ada")))

const exists = sql`EXISTS (${selectedNames}) AND ${users.name} <> ${"root"}`

render(exists, postgresDialect())
// {
//   text: 'EXISTS (SELECT "users"."name" AS "display_name" FROM "users" WHERE ("users"."name" = $1)) AND "users"."name" <> $2',
//   parameters: ['Ada', 'root'],
// }
```

The template owns punctuation such as the parentheses around the query. Qubu
renders a query substitution with SQL-facing projection names, as it does for
CTEs and scalar subqueries.

## Declare a result domain

An unannotated template has application output `unknown` and SQL domain
`SqlUnknown`. State both facts when the expression feeds typed operations or a
named projection:

```ts
import { from, select, sql } from "qubu"
import type { SqlText } from "qubu"

const normalizedName = sql.type<string, SqlText>()`LOWER(${users.name})`

const query = select({ name: normalizedName }, from(users))
// typeof query.row is { name: string }
```

`sql.type<Output, SqlType>()` changes only TypeScript metadata. It does not
parse the SQL or validate the declared types against the database. The tag
still binds ordinary substitutions.

Interpolated fragments contribute their source requirements and
nullability. For example, a `sql.type<string, SqlText>()` template containing a
column from the right side of a `leftJoin()` produces `string | null` in the
selected row.

## Keep identifiers and dynamic syntax explicit

Use the substitution kind that matches the value:

| Input                                 | Rendering behavior                                            |
| ------------------------------------- | ------------------------------------------------------------- |
| Fixed template text                   | Trusted SQL syntax, appended unchanged                        |
| An ordinary substitution              | Bound parameter                                               |
| A Qubu expression, query, or fragment | Rendered through the current dialect and placeholder sequence |
| `identifier(name)`                    | One dialect-quoted identifier                                 |
| `qualifiedIdentifier(schema, table)`  | Several dialect-quoted identifier parts                       |
| `unsafeExpression(text)`              | Unchecked SQL text                                            |

Do not use a dotted string as an identifier. Pass each part to
`qualifiedIdentifier()`. Keep `unsafeExpression()` for application-controlled
syntax that cannot use a fixed template segment:

```ts
import { sql } from "qubu"
import { identifier, unsafeExpression } from "qubu/core"

const sortColumn = "display_name"
const direction = "DESC" as const

const ordering = sql`ORDER BY ${identifier(sortColumn)} ${unsafeExpression(direction)}`
```

Validate any dynamic syntax against an application-owned allowlist before it
reaches `unsafeExpression()`.

## Preserve metadata through interpolated fragments

The tag inherits source dependencies, conservative outer-join nullability,
grouping facts, aggregate and window state, subquery state, and dialect
capability requirements from Qubu fragment substitutions. It does not infer
those facts from unchecked template text.

Use a built-in expression as the substitution when its semantics matter:

```ts
import { count, sql } from "qubu"
import type { SqlInteger } from "qubu"

const postCount = sql.type<number, SqlInteger>()`${count(posts.id)}`
```

This wrapper retains the aggregate dependency recorded by `count()`. Writing
the aggregate name in template text would not record that fact:

```ts
const untrackedPostCount = sql.type<number, SqlInteger>()`COUNT(${posts.id})`
```

This renders valid SQL, but Qubu sees an ordinary column dependency because it
does not parse `COUNT` from the template text.

Declare a capability when the template text itself uses dialect-specific
syntax:

```ts
import { sql } from "qubu"
import { withDialectCapability } from "qubu/core"
import type { SqlBoolean } from "qubu"

const postgresMatch = withDialectCapability(
  sql.type<boolean, SqlBoolean>()`${users.name} ILIKE ${search}`,
  "ilike",
)
```

Rendering `postgresMatch` now requires a dialect that advertises `ilike`.

Use [Fragments and metadata](../query-model/fragments.md) for the inherited
facts, and [SQL semantic types](../sql-semantic-types.md) for result-domain
compatibility.
