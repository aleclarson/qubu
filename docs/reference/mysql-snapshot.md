# MySQL snapshot support

> Use this matrix before selecting `mysqlSnapshotAdapter`; it records the
> MySQL facts Qubu v1 can encode and the combinations that need a later server
> version or engine policy.

Import the adapter from the optional snapshot entrypoint:

```ts
import {
  createMysqlSchemaSnapshot,
  tryCreateMysqlSchemaSnapshot,
} from 'qubu/snapshot'

const snapshot = createMysqlSchemaSnapshot(appSchema)
const result = tryCreateMysqlSchemaSnapshot(appSchema)
```

The snapshot dialect is named `mysql`, the same name used by Qubu's query
renderer. A dialect-tagged `unsafeSchemaSql('mysql', sql)` expression belongs
to this adapter.

## Support matrix

| Schema fact         | MySQL v1 behavior                                                                                                                                                                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Portable storage    | Maps `integer` to `INT`, `numeric` to `DECIMAL`, `text` to `TEXT`, `boolean` to `BOOLEAN`, `date` to `DATE`, `timestamp` to `DATETIME`, `uuid` to `CHAR(36)`, `json` to `JSON`, `bigint` to `BIGINT`, and `binary` to `VARBINARY`.                  |
| Native storage      | Preserves a non-empty declaration tagged `mysql` exactly. Native declarations owned by another dialect fail.                                                                                                                                        |
| Literals            | Encodes `NULL`, finite numbers, strings, booleans, and `bigint` without query parameters. Strings use SQL quote doubling.                                                                                                                           |
| Defaults            | Canonical literals, branded deterministic expressions, and explicit external behavior are retained. Default expressions cannot reference columns or parameters.                                                                                     |
| `ON UPDATE`         | A branded, parameter-free column expression is retained as `onUpdate`. PostgreSQL and SQLite adapters diagnose this MySQL-only fact.                                                                                                                |
| AUTO_INCREMENT      | `identityColumn(..., { dialect: { dialect: 'mysql', autoIncrement: true } })` is retained as a column-level identity extension. The column must be non-nullable, integer-family storage, and the first term of a key.                               |
| Generated columns   | Both `stored` and `virtual` modes are retained. Generated columns cannot also use `ON UPDATE` or `AUTO_INCREMENT`.                                                                                                                                  |
| Keys and checks     | Primary keys, strict unique keys, ordinary unique constraints, foreign keys, and checks retain logical and physical names, actions, and typed MySQL extension data.                                                                                 |
| Foreign keys        | `MATCH SIMPLE` and standard actions except `SET DEFAULT` are supported. `MATCH FULL`, `MATCH PARTIAL`, deferrability, and `SET DEFAULT` are diagnosed.                                                                                              |
| Nullable uniqueness | `nulls: 'distinct'` is supported. `nulls: 'not-distinct'` is diagnosed because ordinary MySQL `UNIQUE` constraints allow multiple `NULL` values.                                                                                                    |
| Indexes             | Ordered terms, expressions, uniqueness, and candidate-key evidence are retained. Partial predicates, included columns, and `NULLS FIRST/LAST` are diagnosed. Algorithm, locking, access method, parser, and key-block options live under `dialect`. |
| Names               | Table, column, constraint, and index names are checked against MySQL's 64-character identifier limit. Table names are database-scoped; index names are table-scoped.                                                                                |

Capability checks run before common traversal. Use the non-throwing form when
a schema may include a MySQL engine or version-specific feature:

```ts
const result = tryCreateMysqlSchemaSnapshot(appSchema)
if (!result.ok) {
  for (const issue of result.diagnostics) {
    console.error(issue.path.join('.'), issue.code, issue.message)
  }
}
```

The adapter does not connect to MySQL, inspect `information_schema`, or
generate DDL. It only produces deterministic data for the strict
`qubu/snapshot` decoder and later schema tooling.
