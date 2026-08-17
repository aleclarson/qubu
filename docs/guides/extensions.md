# Extend Qubu

> Add a small dialect policy, expression, or clause when the standard surface does not cover a driver-specific or uncommon SQL feature.

## Prefer a value-level extension

Qubu extensions are ordinary fragments. A custom clause supplies a placement,
render order, and renderer:

```ts
import { customClause, from, render, select, table, text } from 'qubu'

const users = table('users', { name: text() })

const fetchWithTies = customClause<never, number>({
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

The `number` parameter metadata documents the value bound by the custom
renderer, and the rendered parameter is still ordered with every other
parameter in the query.

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

`fragment()`, `makeExpression()`, `parameter()`, `identifier()`, `syntax()`, and
`customClause()` are the public building blocks for extensions. Preserve the
same metadata that built-ins preserve:

- require every source that the expression reads;
- expose the correct output type;
- declare the value types the renderer can parameterize; and
- use `context.parameter()` for values instead of concatenating them into SQL.

## Use unsafe primitives only for intentional raw syntax

`unsafeExpression()` and related escape hatches exist for syntax that cannot be
modeled yet. They do not quote identifiers or bind values for you:

```ts
import { aliasExpression, select, unsafeExpression } from 'qubu'

const query = select({
  today: aliasExpression(unsafeExpression('CURRENT_DATE'), 'today'),
})
```

Keep raw identifiers and values out of the string, and prefer a typed custom
fragment when the syntax will be reused. Read [Dialects and execution](../concepts/dialects-and-execution.md)
for the boundary between rendering and driver behavior.
