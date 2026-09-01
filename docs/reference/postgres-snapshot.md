# PostgreSQL snapshot support

> Use this matrix before selecting `postgresSnapshotAdapter`; it records the
> PostgreSQL facts Qubu v2 can encode and the cases that need a later server
> version policy.

Import the adapter from the PostgreSQL snapshot subpath:

```ts
import { createSchemaSnapshot } from "qubu/snapshot"
import {
  createSchemaSnapshot as createPostgresSnapshot,
  postgresSnapshotAdapter,
} from "qubu/snapshot/postgres"

const snapshot = createPostgresSnapshot(appSchema)
// Equivalent: createSchemaSnapshot(appSchema, { adapter: postgresSnapshotAdapter })
```

The schema dialect extends Qubu's existing `postgresql` query dialect, so both
snapshot metadata and `unsafeSchemaSql()` use `postgresql` consistently.

## Support matrix

| Schema fact         | PostgreSQL v2 behavior                                                                                                                                                                                                       |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Portable storage    | Emits PostgreSQL declarations: `INTEGER`, `NUMERIC`, `TEXT`, `BOOLEAN`, `DATE`, `TIMESTAMP`, `UUID`, `JSONB`, `BIGINT`, and `BYTEA`.                                                                                         |
| Native storage      | Preserves a non-empty declaration tagged `postgresql` exactly. Other dialect tags fail.                                                                                                                                      |
| Literals            | Encodes finite numbers, strings, booleans, `bigint`, and `NULL` without query parameters.                                                                                                                                    |
| Defaults            | Canonical literals, branded deterministic expressions, and explicit external behavior are retained. Column references in defaults fail.                                                                                      |
| Identity            | `always` and `by-default` identity metadata stays separate from generated expressions.                                                                                                                                       |
| Generated columns   | Stored expressions are supported. Virtual generated columns fail with a capability diagnostic.                                                                                                                               |
| Keys and checks     | Primary keys, strict unique keys, ordinary unique constraints, foreign keys, and checks retain names, timing, actions, and expressions. Checks cannot be deferrable.                                                         |
| Foreign-key match   | `simple` and `full` are retained. `partial` fails because PostgreSQL does not implement it.                                                                                                                                  |
| Nullable uniqueness | `nulls: 'distinct'` is portable. `nulls: 'not-distinct'` needs a PostgreSQL 15-or-newer policy and is rejected by v2.                                                                                                        |
| Indexes             | Ordered terms, expressions, predicates, included columns, uniqueness, and candidate-key evidence are retained. PostgreSQL method, concurrency, operator class, and storage-parameter extensions are encoded under `dialect`. |
| Names               | Table, column, constraint, and index names are checked against PostgreSQL's 63-byte identifier limit. Relation names are checked for collisions across tables and indexes.                                                   |

The adapter does not connect to PostgreSQL or emit DDL. It produces
deterministic data for the `qubu/snapshot` decoder. The package-wide
[ownership map](supported-surface.md#ownership-boundary) shows the separate
schema and application boundaries.

## Diagnostics

Use the non-throwing form when a schema may contain a server-specific feature:

```ts
import { tryCreateSchemaSnapshot } from "qubu/snapshot/postgres"

const result = tryCreateSchemaSnapshot(appSchema)
if (!result.ok) {
  for (const issue of result.diagnostics) {
    console.error(issue.path.join("."), issue.code, issue.message)
  }
}
```

Capability checks run before common traversal. The common serializer still
owns ordering, cross-reference checks, canonical encoding, and strict snapshot
validation.
