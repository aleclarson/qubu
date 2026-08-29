# Migration plans

> Describe reviewed snapshot changes as deterministic data before selecting a DDL emitter.

The `@qubu/migrate/plan` entrypoint consumes a resolved `SnapshotDiff` and
returns an immutable migration-plan IR. It contains operation IDs, paths,
logical and physical identity evidence, dependency edges, preconditions, safety,
lock and transaction requirements, and reversibility markers.

```ts
import { createMigrationPlan } from "@qubu/migrate/plan"

const result = createMigrationPlan(diff)
if (!result.ok) {
  // Review result.plan.diagnostics and provide explicit decisions.
}
```

Creation is pure. The planner does not open a connection, execute a transaction,
render SQL, or create migration history. A physical rename remains a
`physical-rename` operation; it is never represented as custom SQL or silently
changed into a drop and add.

## Safety decisions

Safe operations can be inspected immediately. Destructive, review-required,
unsupported, unknown, and lossy facts remain blocked until an explicit decision
or matching option is supplied. Decisions are tied to an operation ID or to a
kind, namespace, and path, and each decision carries a review reason.

```ts
const reviewed = createMigrationPlan(diff, {
  decisions: result.plan.operations
    .filter((operation) => operation.status === "decision-required")
    .map((operation) => ({
      operationId: operation.id,
      action: "allow",
      reason: "Reviewed against the deployment change request",
    })),
})
```

Unknown or lossy records are not converted into SQL. If a dialect-specific step
is genuinely needed, attach it explicitly with `customSql`, including its
dialect, safety declaration, reason, reversibility, and dependency position:

```ts
createMigrationPlan(diff, {
  customSql: [
    {
      sql: "ALTER TABLE accounts VALIDATE CONSTRAINT accounts_check",
      dialect: { name: "postgresql", version: 1 },
      safety: "review-required",
      reason: "The dialect emitter does not model this catalog fact yet",
      reversible: false,
      position: 3,
    },
  ],
})
```

The string is retained as an explicit custom operation only. The planner never
extracts SQL from opaque catalog payloads.

## Ordering and validation

Parent creation precedes child creation, while child removal precedes parent
removal. Reference edges and explicit custom-SQL dependencies are included in
the stable topological ordering. `encodeMigrationPlan()` emits canonical JSON;
`decodeMigrationPlan()` and `validateMigrationPlan()` reject unknown fields,
future versions, malformed operations, missing edges, and dependency cycles.

After review and approval, pass the plan to
[`@qubu/migrate/ddl`](./ddl-emission.md). DDL emission remains separate from
application-owned migration execution in the package-wide [ownership
map](../reference/supported-surface.md#ownership-boundary).
