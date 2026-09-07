# Use unsafe syntax

> Keep raw SQL visible and trusted when Qubu does not model the syntax you need.

`unsafeExpression()` and related escape hatches exist for syntax that cannot be
modeled yet. They do not quote identifiers or bind values for you:

```ts
import { select } from "qubu"
import { unsafeExpression } from "qubu/core"

const query = select({
  today: unsafeExpression("CURRENT_DATE"),
})
```

## Choose the right helper

Keep raw identifiers and values out of the string:

- Use a typed custom fragment for syntax you will reuse.
- Use the [`sql` template tag](../sql-templates.md) for fixed trusted syntax
  with bound values or existing Qubu fragments.
- Use `unsafeExpression()` for trusted dynamic SQL text.
- Use `identifier()` or `qualifiedIdentifier()` from `qubu/core` for runtime
  identifiers.

Read [Dialects and execution](../../dialects-and-execution.md) for the boundary
between rendering and driver behavior. Read [Add typed
expressions](typed-expressions.md) when the extension needs a result domain or
source metadata.
