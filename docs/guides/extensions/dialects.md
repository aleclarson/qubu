# Add a dialect policy

> Change identifiers, placeholders, pagination, or cast targets at the rendering boundary without changing portable query construction.

Use `createDialect()` when the query is portable but the driver changes
identifiers, placeholders, or pagination:

The examples assume a query has already been built.

```ts
import { render } from 'qubu'
import { createDialect } from 'qubu/core'

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

For the full rendering and execution boundary, read
[Dialects and execution](../../dialects-and-execution.md). It covers capability
requirements, the driver adapter, and the values that cross the boundary.

For syntax that is not a small policy decision, add a
[custom fragment or clause](sources-and-clauses.md) instead of making the
standard dialect pretend that vendor behavior is portable.

## Read next

- [Add sources and clauses](sources-and-clauses.md) covers custom relations and
  clause placement.
- [Add typed expressions](typed-expressions.md) covers custom SQL domains and
  cast targets.
