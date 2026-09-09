# Add typed expressions

> Build custom expressions that preserve result types and query checks.

## Build expressions from public helpers

The examples use the `users` table from [Sources and clauses](sources-and-clauses.md).

`fragment()`, `makeExpression()`, `parameter()`, `identifier()`, `syntax()`,
`customClause()`, and `customSource()` are public extension building blocks.
Import fragment, dialect, and expression constructors from `qubu/core`; import
custom source and schema metadata constructors from `qubu/schema`. Preserve the
same metadata model that built-ins use:

- use `RequiresSourceMeta<Source>` for every source that the expression reads;
- use `ResultMeta<Output, NullableFrom, SqlType>` when the fragment exposes a
  typed result, or accept its default `SqlUnknown` domain intentionally;
- inherit child source and nullability facts when composing fragments; and
- use `context.parameter()` for values instead of concatenating them into SQL.

`sequence()` is useful for a reusable fragment assembled from arbitrary child
fragments. Its `const` type parameter preserves the children's metadata, so
source-scope checking continues to work without `as const` at the call site.

## Declare a custom SQL domain

Extend `SqlSemanticType` and only the portable capabilities the database type
actually supports. Compatibility groups allow a dialect-specific domain to
interoperate with a built-in family:

```ts
import { cast, column } from "qubu"
import type { SqlEqualityComparable, SqlOrderable, SqlSemanticType, SqlTextLike } from "qubu"

interface SqlCitext
  extends
    SqlSemanticType<"postgres.citext">,
    SqlTextLike,
    SqlOrderable<"text">,
    SqlEqualityComparable<"text"> {}

const citext = column<string, string, string, SqlCitext>({
  castType: "CITEXT",
})

const nameAsCitext = cast(users.name, citext)
```

The first three `column` type arguments are output, insert, and update values;
the fourth is the SQL domain.

The `text` equality and ordering groups make the custom domain compatible with `SqlText`. Use a distinct group when cross-type
comparison is not portable.

### Use the definition as a cast target

`castType` also makes this definition a cast target. Its SQL text is emitted
unchanged, so keep it in trusted extension code.

Definitions with schema flags are not accepted as cast targets because cast
nullability comes from the operand and write flags have no cast meaning.

### Type individual expressions

Declare result domains at other extension boundaries too:

```ts
import { typedCall, typedCast, typedValue, unsafeExpression } from "qubu/core"
import type { SqlText, SqlUuid } from "qubu"

const id = typedValue<SqlUuid, string>("108cb836-20d2-41b2-8c23-f0c94700aa7e", "uuid")
const normalized = typedCall<SqlText, string>()("custom_text", users.name)
const rawNameAsText = typedCast<string, SqlText>()(users.name, "TEXT")
const generated = unsafeExpression<string, SqlText>("custom_text()")
```

Choose the helper for the operation:

- `typedCall()` preserves source requirements from its arguments.
- `typedCast()` supplies a cast target when no reusable definition describes
  it. It preserves operand nullability and source metadata, and emits the
  supplied type name unchanged.
- `typedValue()` binds a parameter and declares its runtime SQL domain for
  the adapter. It does not choose a JavaScript result decoder; schema columns
  carry decoder metadata separately.
- `unsafeExpression()` emits its string unchanged. Use it only when the other
  helpers cannot express the syntax.

The lower-level forms also expose the SQL domain in their generic lists:
`call<Output, Name, Arguments, NullableFrom, SqlType>()` and
`cast<Output, SqlType>()`. They are useful when an extension already computes
argument or nullability types in its own generic signature.

Untyped `column()`, `value()`, `call()`, and custom expressions use
`SqlUnknown`, which allows composition without SQL-domain checks. Declaring a
known domain opts the extension into incompatible-operation errors. See
[SQL semantic types](../../sql-semantic-types.md) for the capability model and
its limits.

## Declare a downstream aggregate

Define reusable SQL aggregates in application or extension code with `call()`
and `makeExpression()`. This factory uses existing public APIs; it is not a
Qubu export:

```ts
import { call } from "qubu"
import type { AggregateMeta, DependenciesOf, MetadataOf } from "qubu"
import { makeExpression } from "qubu/core"

function aggregateFunction<TOutput>(name: string) {
  return <const TArgs extends readonly unknown[]>(...args: TArgs) => {
    const expression = call<TOutput, string, TArgs>(name, ...args)

    return makeExpression<
      | MetadataOf<typeof expression>
      | AggregateMeta<DependenciesOf<typeof expression>>,
      "function"
    >(
      "function",
      context => context.render(expression),
      "aggregate",
    )
  }
}

const jsonGroupArray = aggregateFunction<string>("json_group_array")
```

The returned function infers its argument tuple on each call. Passing that
tuple explicitly to `call()` preserves source requirements, dependencies,
nullability, and capability requirements. Using only `call<string>(...)`
would default the remaining type parameters and lose argument metadata.

`AggregateMeta` records the dependencies consumed by the aggregate, enabling
grouping checks. The `"aggregate"` constructor argument also marks the runtime
expression category. `markExpressionCategory(expression, "aggregate")` alone
only sets that runtime marker; it does not add type-level aggregate metadata.

For a SQLite query, declare the function once and use it in projections:

```ts
import { from, groupBy, select, table, text } from "qubu"

const gameCategory = table("game_category", {
  gameId: text(),
  name: text(),
})

const categoriesByGame = select(
  {
    gameId: gameCategory.gameId,
    categories: jsonGroupArray(gameCategory.name),
  },
  from(gameCategory),
  groupBy(gameCategory.gameId),
)
```

Qubu rejects a missing argument source, an ungrouped selected column, or an
aggregate used as a grouping key. The factory uses `call()`'s default
`SqlUnknown` result domain and argument-derived nullability; declare a different
result contract in the downstream helper when the SQL function requires one.
`TOutput` declares the JavaScript result type without decoding database values.

Keep the function catalog, argument restrictions, decoding, null filtering,
distinctness, and sorting policy downstream. An application can decode the
returned JSON text with its own `parseCategories()` helper after execution, or
attach its decoder with `mapResult()`.

## Read next

- [Add sources and clauses](sources-and-clauses.md) covers custom relations and
  clause renderers.
- [Use unsafe syntax](unsafe-syntax.md) covers the raw-SQL boundary.
