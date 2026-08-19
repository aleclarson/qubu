# Extend Qubu

> Add a small dialect policy, expression, or clause when the standard surface does not cover a driver-specific or uncommon SQL feature.

## Prefer a value-level extension

Qubu extensions are ordinary fragments. A custom clause supplies a placement,
render order, and renderer:

```ts
import { customClause, from, render, select, table, text } from 'qubu'

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
import {
  customSource,
  from,
  identifier,
  integer,
  render,
  select,
  text,
} from 'qubu'

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
`leftJoin(rows, ...)` adds outer-join nullability to every selected row column.
Render the complete relation in the producer and bind values with
`context.parameter()`; the normal renderer preserves parameter order.

## Add a policy with `createDialect()`

Use a dialect when the query is portable but the driver changes identifiers,
placeholders, or pagination:

```ts
import { createDialect, render } from 'qubu'

const colonDialect = createDialect({
  name: 'colon',
  placeholder: position => ':p' + position,
})

render(query, colonDialect)
// ... WHERE ... = :p1
```

`createDialect()` uses Qubu's standard double-quoted identifier policy unless
you provide `quoteIdentifier`. A complete pagination policy can be supplied
through the optional `pagination` renderer.

## Build expressions from public primitives

`fragment()`, `makeExpression()`, `parameter()`, `identifier()`, `syntax()`,
`customClause()`, and `customSource()` are the public building blocks for
extensions. Preserve the
same metadata model that built-ins use:

- use `RequiresSourceMeta<Source>` for every source that the expression reads;
- use `ResultMeta<Output, NullableFrom, SqlType>` when the fragment exposes a
  typed result, or accept its default `SqlUnknown` domain intentionally;
- inherit child source and nullability facts when composing fragments; and
- use `context.parameter()` for values instead of concatenating them into SQL.

`sequence()` is useful for a reusable fragment assembled from arbitrary child
fragments: its `const` type parameter preserves the children's metadata, so
source-scope checking continues to work without `as const` at the call site.

## Declare a custom SQL domain

Extend `SqlSemanticType` and only the portable capabilities the database type
actually supports. Compatibility groups allow a dialect-specific domain to
interoperate with a built-in family:

```ts
import { cast, column } from 'qubu'
import type {
  SqlEqualityComparable,
  SqlOrderable,
  SqlSemanticType,
  SqlTextLike,
} from 'qubu'

interface SqlCitext
  extends SqlSemanticType<'postgres.citext'>,
    SqlTextLike,
    SqlOrderable<'text'>,
    SqlEqualityComparable<'text'> {}

const citext = column<string, string, string, SqlCitext>({
  castType: 'CITEXT',
})

const nameAsCitext = cast(users.name, citext)
```

The first three `column` type arguments are output, insert, and update values;
the fourth is the SQL domain. The `text` equality and ordering groups make the
custom domain compatible with `SqlText`. Use a distinct group when cross-type
comparison is not portable. `castType` also makes this plain definition a cast
target; its SQL text is emitted verbatim, so keep it in trusted extension code.
Definitions with schema flags are not accepted as cast targets because cast
nullability comes from the operand and write flags have no cast meaning.

Declare result domains at other extension boundaries too:

```ts
import { typedCall, typedCast, typedValue, unsafeExpression } from 'qubu'
import type { SqlText, SqlUuid } from 'qubu'

const id = typedValue<SqlUuid, string>('108cb836-20d2-41b2-8c23-f0c94700aa7e')
const normalized = typedCall<SqlText, string>()('custom_text', users.name)
const rawNameAsText = typedCast<string, SqlText>()(users.name, 'TEXT')
const generated = unsafeExpression<string, SqlText>('custom_text()')
```

`typedCall()` preserves source requirements from its arguments. `typedCast()`
is the flexible fallback when no reusable definition describes the target; it
preserves operand nullability and source metadata while emitting its supplied
type name verbatim. `typedValue()` binds a parameter. `unsafeExpression()`
emits its string unchanged and should remain a last resort.

Use the typed wrappers when an extension cannot reuse a schema definition. The
lower-level forms also expose the SQL domain in their generic lists:
`call<Output, Name, Arguments, NullableFrom, SqlType>()` and
`cast<Output, SqlType>()`. They are useful when an extension already computes
argument or nullability types in its own generic signature.

Untyped `column()`, `value()`, `call()`, and custom expressions use
`SqlUnknown`, which stays permissive for backward compatibility. Declaring a
known domain opts the extension into incompatible-operation errors. See [SQL
semantic types](../concepts/sql-semantic-types.md) for the capability model and
its non-goals.

## Use unsafe primitives only for intentional raw syntax

`unsafeExpression()` and related escape hatches exist for syntax that cannot be
modeled yet. They do not quote identifiers or bind values for you:

```ts
import { select, unsafeExpression } from 'qubu'

const query = select({
  today: unsafeExpression('CURRENT_DATE'),
})
```

Keep raw identifiers and values out of the string, and prefer a typed custom
fragment when the syntax will be reused. Read [Dialects and execution](../concepts/dialects-and-execution.md)
for the boundary between rendering and driver behavior.
