# Use unsafe syntax

> Keep raw SQL visible and trusted when Qubu does not model the syntax you need.

`unsafeExpression()` and related escape hatches exist for syntax that cannot be
modeled yet. They do not quote identifiers or bind values for you:

```ts
import { select } from 'qubu'
import { unsafeExpression } from 'qubu/core'

const query = select({
  today: unsafeExpression('CURRENT_DATE'),
})
```

Keep raw identifiers and values out of the string. Prefer a typed custom
fragment when the syntax will be reused. Use the [`sql` template
tag](../sql-templates.md) when fixed trusted syntax needs bound runtime values
or existing Qubu fragments. Keep dynamic SQL text on `unsafeExpression()` and
runtime identifiers on `identifier()` or `qualifiedIdentifier()` from
`qubu/core`.

Read [Dialects and execution](../../dialects-and-execution.md) for the boundary
between rendering and driver behavior. Read [Add typed
expressions](typed-expressions.md) when the extension needs a result domain or
source metadata.
