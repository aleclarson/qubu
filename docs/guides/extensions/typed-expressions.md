# Add typed expressions

> Extend Qubu with expressions that retain source, nullability, result, and SQL-domain metadata.

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
the fourth is the SQL domain. The `text` equality and ordering groups make the
custom domain compatible with `SqlText`. Use a distinct group when cross-type
comparison is not portable. `castType` also makes this definition a cast
target; its SQL text is emitted verbatim, so keep it in trusted extension code.
Definitions with schema flags are not accepted as cast targets because cast
nullability comes from the operand and write flags have no cast meaning.

Declare result domains at other extension boundaries too:

```ts
import { typedCall, typedCast, typedValue, unsafeExpression } from "qubu/core"
import type { SqlText, SqlUuid } from "qubu"

const id = typedValue<SqlUuid, string>("108cb836-20d2-41b2-8c23-f0c94700aa7e", "uuid")
const normalized = typedCall<SqlText, string>()("custom_text", users.name)
const rawNameAsText = typedCast<string, SqlText>()(users.name, "TEXT")
const generated = unsafeExpression<string, SqlText>("custom_text()")
```

`typedCall()` preserves source requirements from its arguments. `typedCast()`
is the fallback when no reusable definition describes the target. It preserves
operand nullability and source metadata while emitting its supplied type name
verbatim. `typedValue()` binds a parameter and declares its runtime SQL domain
for the adapter; it does not select a JavaScript result decoder. Schema columns
carry result-decoder metadata separately. `unsafeExpression()` emits its string
unchanged and should remain a last resort.

The lower-level forms also expose the SQL domain in their generic lists:
`call<Output, Name, Arguments, NullableFrom, SqlType>()` and
`cast<Output, SqlType>()`. They are useful when an extension already computes
argument or nullability types in its own generic signature.

Untyped `column()`, `value()`, `call()`, and custom expressions use
`SqlUnknown`, which stays permissive for backward compatibility. Declaring a
known domain opts the extension into incompatible-operation errors. See
[SQL semantic types](../../sql-semantic-types.md) for the capability model and
its limits.

## Read next

- [Add sources and clauses](sources-and-clauses.md) covers custom relations and
  clause renderers.
- [Use unsafe syntax](unsafe-syntax.md) covers the raw-SQL boundary.
