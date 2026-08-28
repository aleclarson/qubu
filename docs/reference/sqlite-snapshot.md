# SQLite snapshot support

> Use this matrix to decide which SQLite schema facts Qubu v1 can serialize and which combinations must be diagnosed before a snapshot is written.

Import the adapter from the optional snapshot entrypoint:

```ts
import { createSqliteSchemaSnapshot, tryCreateSqliteSchemaSnapshot } from "qubu/snapshot"

const snapshot = createSqliteSchemaSnapshot(appSchema)
const result = tryCreateSqliteSchemaSnapshot(appSchema)
```

The snapshot dialect is `sqlite`, the same name used by Qubu's query dialect.
This shared name is intentional: SQLite does not need a second metadata identity
to distinguish it from the query renderer. A dialect-tagged
`unsafeSchemaSql('sqlite', sql)` expression belongs to this adapter.

## Support matrix

| Schema fact         | SQLite v1 behavior                                                                                                                                                                                                                            |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Portable storage    | Maps `integer`, `boolean`, and `bigint` to `INTEGER`; `text`, `date`, `timestamp`, `uuid`, and `json` to `TEXT`; `numeric` to `NUMERIC`; and `binary` to `BLOB`. The snapshot also records SQLite's derived affinity.                         |
| Native storage      | Preserves a non-empty declaration tagged `sqlite` exactly and records its affinity using SQLite's ordered declared-type rules. Other dialect tags fail.                                                                                       |
| Literals            | Encodes `NULL`, finite numbers, strings, `bigint`, and booleans as parameter-free SQL. Boolean literals use `1` and `0`; strings retain SQL escaping.                                                                                         |
| Defaults            | Canonical literals, branded deterministic expressions, and explicit external behavior are retained. Default expressions cannot reference columns or parameters.                                                                               |
| Generated columns   | Both `stored` and `virtual` modes are retained. Generated columns cannot be used in a SQLite `PRIMARY KEY`; expressions still pass through the shared deterministic schema-expression boundary.                                               |
| Identity and rowids | Identity columns require INTEGER affinity and a single-column `PRIMARY KEY`. Set `identityColumn(..., { dialect: { dialect: 'sqlite', autoIncrement: true } })` only with an exact `INTEGER` declaration to represent SQLite `AUTOINCREMENT`. |
| Keys and checks     | Primary keys, strict unique keys, ordinary unique constraints, foreign keys, and checks retain logical and physical names. Constraint `DEFERRABLE` timing is diagnosed except on foreign keys.                                                |
| Foreign keys        | Standard update/delete actions and `MATCH SIMPLE` are retained. `MATCH FULL` and `MATCH PARTIAL` are diagnosed because the v1 adapter does not claim SQLite support for them.                                                                 |
| Nullable uniqueness | `nulls: 'distinct'` is supported. `nulls: 'not-distinct'` is diagnosed because SQLite's ordinary UNIQUE semantics distinguish NULLs.                                                                                                          |
| Indexes             | Ordered terms, expressions, uniqueness, predicates for partial indexes, and candidate-key evidence are retained. Included columns are diagnosed as unsupported. The typed SQLite index extension is encoded under `dialect`.                  |
| Namespaces          | An optional unqualified namespace is retained; Qubu does not attach or inspect SQLite databases.                                                                                                                                              |

Capability checks run before common traversal. Use the non-throwing form when a
schema may include a feature that depends on a SQLite version or table shape:

```ts
const result = tryCreateSqliteSchemaSnapshot(appSchema)
if (!result.ok) {
  for (const issue of result.diagnostics) {
    console.error(issue.path.join("."), issue.code, issue.message)
  }
}
```

The adapter does not connect to SQLite, inspect `sqlite_master`, or emit DDL.
It produces deterministic data for the strict `qubu/snapshot` decoder. The
package-wide [ownership map](supported-surface.md#ownership-boundary) shows
the separate schema and application boundaries.
