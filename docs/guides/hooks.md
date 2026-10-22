# Observe query operations

> Attach lifecycle observations without changing database results.

Use a bound client from [Execute queries](execution.md). The example assumes
its `db.adapter` and a read query named `readQuery`.

Configure hooks on a bound client when logs, traces, or metrics need the same
lifecycle view across queries, streams, plans, and transactions:

```ts
import { qubu } from "qubu"

const observedDb = qubu(db.adapter, {
  hooks: {
    onOperationStart(operation) {
      console.info("Qubu operation started", operation)

      return (outcome) => {
        console.info("Qubu operation finished", operation.id, outcome)
      }
    },
    onHookError(error) {
      console.error("Qubu hook failed", error)
    },
  },
})

await observedDb.rows(readQuery, {
  hookMetadata: { operation: "users.list" },
})
```

Query operations start after rendering and immediately before the adapter is
called. Completion reports duration, success or the original error, and
available aggregate facts such as row and affected-row counts. Transaction
queries identify their parent transaction operation. Hooks are synchronous,
and their failures are sent to `onHookError` without changing the database
operation's result.

## What observations include

Hook metadata accepts only strings, numbers, and booleans. Observations include
rendered SQL and parameter count, but never parameter values, result rows,
decoded values, or insert identifiers. Rendered SQL can still contain literals
introduced by unsafe SQL helpers, so treat it according to the application's
logging policy.

## Stream observation timing

Streaming adapters are still called eagerly. A consumed stream completes its
observation when it is exhausted, closed early, or fails. A stream created but
never consumed has no completion observation. Hooks are available only on
clients created with `qubu()`; standalone execution functions remain
unobserved.
