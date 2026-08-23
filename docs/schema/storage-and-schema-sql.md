# Storage and schema SQL

> Keep application types, SQL domains, physical storage, and schema expressions separate so each adapter can make its own rendering decision.

## Keep application and SQL types separate

A column can have an application value type, a SQL semantic domain, a physical
storage descriptor, and a cast target. These facts answer different questions.

For example, `numeric()` decodes to a TypeScript number, carries `SqlDecimal`,
uses portable numeric storage, and has a logical decimal cast target. Read
[SQL semantic types](../sql-semantic-types.md) for operator compatibility and
contextual literals.

## Record physical storage

Built-in helpers use portable storage descriptors:

| Helper      | Portable storage |
| ----------- | ---------------- |
| integer()   | integer          |
| numeric()   | numeric          |
| text()      | text             |
| boolean()   | boolean          |
| date()      | date             |
| timestamp() | timestamp        |
| uuid()      | uuid             |
| json<T>()   | json             |
| bigint()    | bigint           |
| binary()    | binary           |

Use a dialect-native descriptor when a column needs an exact vendor
declaration:

```ts
import { nativeColumn, nativeStorage, table } from 'qubu'

const accounts = table('accounts', {
  handle: nativeColumn(nativeStorage('postgresql', 'citext COLLATE "C"')),
})
```

`nativeStorage()` preserves the declaration text and freezes the descriptor. The
`ColumnStorageOf`, `ColumnStorageTypeOf`, `ColumnStorageDialectOf`, and
`ColumnStorageDeclarationOf` helpers read its metadata. Native storage is
descriptive. It does not change selection, mutation, or query rendering.

## Render deterministic schema expressions

Schema SQL uses a different context from query SQL. Built-in scalar expressions
can be rendered for checks, generated columns, indexes, and other declaration
metadata:

```ts
import { eq, table, text } from 'qubu'
import { renderSchemaSql } from 'qubu/schema'

const accounts = table('accounts', { status: text() })

renderSchemaSql(eq(accounts.status, 'active'), { mode: 'check' })
// ("status" = 'active')
```

The schema context emits SQL literals instead of placeholders. It supports
strings, finite numbers, booleans, bigint, and NULL through the portable
fallback. A dialect can provide renderSchemaLiteral for another spelling.
Unsupported values and direct calls to parameter() fail.

Column references render as bare physical identifiers for generated, check, and
index expressions. Default expressions reject column references because a
column default cannot depend on another row value. Aggregates, windows, and
subqueries are rejected in every schema mode.

An extension must opt into the schema contract with `defineSchemaExpression()`:

```ts
import { defineSchemaExpression, renderSchemaSql } from 'qubu/schema'

const currentDate = defineSchemaExpression('function', context => {
  context.append('CURRENT_DATE')
})

renderSchemaSql(currentDate, { mode: 'default' })
```

## Use raw schema SQL only when necessary

Use `unsafeSchemaSql(dialect, sql)` only for trusted, parameter-free syntax that
Qubu does not model. Its dialect tag is checked when rendering, and its text is
preserved apart from normalizing line endings. A normal `makeExpression()`
extension must pass through the explicit `schemaExpression()` audit boundary
before schema rendering accepts it.

> [!WARNING]
> Raw schema SQL does not quote identifiers or bind values. Keep it in trusted
> extension code.

## Read next

- [Tables and names](tables-and-names.md) covers logical IDs and SQL naming.
- [Constraints, keys, and indexes](constraints-and-indexes.md) covers metadata
  consumed by grouped queries and schema adapters.
- [Canonical schema snapshots](snapshots.md) explains how storage and
  constraints become serialized data.
