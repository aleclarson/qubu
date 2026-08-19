# Schema and type metadata

> Describe the application-facing values of a table once, then let Qubu derive selected row, insert, and update types from that description.

`table()` definitions are query-facing schema metadata. They are not database
introspection and they do not create or migrate a database.

## Field names cross an application boundary

Write schema keys in camelCase. Qubu converts them to snake_case when it
renders SQL identifiers, then restores the camelCase keys on the final query
result:

```ts
const events = table('events', {
  userId: uuid(),
  createdAt: timestamp(),
})

const query = select(
  { userId: events.userId, createdAt: events.createdAt },
  from(events)
)
```

The query selects `"events"."user_id"` and `"events"."created_at"`, then
aliases those fields as `"userId"` and `"createdAt"` for the returned row.
Inserts and updates accept the same camelCase keys and target the snake_case
columns.

Acronym boundaries are preserved: `userID` becomes `user_id`, `APIKey` becomes
`api_key`, and `XMLHttpRequest` becomes `xml_http_request`. Prefer conventional
lower camelCase spellings such as `userId` and `apiKey`; they avoid ambiguous
names such as `OAuthID`. Use `sqlName` when the database name does not follow
the convention:

```ts
const events = table('events', {
  createdAt: timestamp({ sqlName: 'creation_timestamp' }),
})
```

Qubu rejects fields that resolve to the same SQL name, such as `userId` and
`userID` in one table.

CTEs, derived tables, lateral queries, and subqueries remain SQL relations, so
their projected names stay snake_case. Only the outer result projection uses
camelCase aliases. Table and relation names remain explicit; pass
`table('user_accounts', ...)` when the database table is named `user_accounts`.

## Column flags change different operations

Every column has an output type and can optionally describe its write-time
behavior:

| Option             | Selected output | Insert input         | Update input        |
| ------------------ | --------------- | -------------------- | ------------------- |
| `nullable: true`   | `T \| null`     | accepts `T \| null`  | accepts `T \| null` |
| `hasDefault: true` | unchanged       | key becomes optional | unchanged           |
| `generated: true`  | unchanged       | key is omitted       | key is omitted      |

Use `column<Output, Insert, Update>()` when the value coming from the driver
differs from the value your application writes:

```ts
const accounts = table('accounts', {
  id: integer({ generated: true }),
  email: text(),
  nickname: text({ nullable: true, hasDefault: true }),
  externalScore: column<number, string, number>({ nullable: true }),
})
```

The selected `externalScore` is `number | null`; inserts accept
`string | null`; updates accept `number | null`.

## Narrow a column's application type

Use `$type<T>()` to narrow a helper's TypeScript type without changing its
runtime column definition:

```ts
const users = table('users', {
  status: text().$type<'active' | 'disabled'>(),
})
```

The narrowed type applies to selected values and to insert and update inputs.
For a custom column whose insert or update type differs from its output type,
the distinct type is preserved. For example,
`column<number, string, number>().$type<1 | 2>()` continues to accept `string`
inserts while narrowing selected and updated values to `1 | 2`.

`$type<T>()` is a compile-time assertion. It does not validate values at
runtime or add a database constraint.

## Common value helpers

The first-party helpers provide application types without dictating how a
driver encodes them:

| Helper                                | Application type    |
| ------------------------------------- | ------------------- |
| `integer()`, `numeric()`              | `number`            |
| `text()`, `uuid()`                    | `string`            |
| `boolean()`                           | `boolean`           |
| `date()`, `timestamp()`, `dateTime()` | `Date`              |
| `json<T>()`                           | caller-supplied `T` |
| `bigint()`                            | `bigint`            |
| `binary()`, `blob()`                  | `Uint8Array`        |

The driver adapter remains responsible for database-specific encoding and row
decoding. A `timestamp()` column describes the TypeScript value; it does not
choose a wire format for a particular database client.

## Read JSON scalars

Use a structured `jsonPath()` when a query needs a string, number, boolean, or
existence check inside a JSON document:

```ts
import {
  from,
  json,
  jsonBoolean,
  jsonExists,
  jsonPath,
  jsonText,
  select,
  table,
} from 'qubu'

const events = table('events', {
  payload: json<{
    user?: { name?: string; active?: boolean }
  }>(),
})

const query = select(
  {
    name: jsonText(events.payload, jsonPath('user', 'name')),
    active: jsonBoolean(events.payload, jsonPath('user', 'active')),
    hasUser: jsonExists(events.payload, jsonPath('user')),
  },
  from(events)
)
```

Strings are object keys and non-negative integers are array indexes. The path
is structured rather than raw SQL, so each dialect can encode keys and indexes
without interpolating caller-provided syntax.

Scalar reads return SQL `NULL` when the path is missing, contains JSON `null`,
or resolves to a different JSON scalar type. `jsonExists()` returns `true` for
a present JSON `null`, `false` for a missing path, and `false` when the document
is SQL `NULL`. These rules keep existence separate from extraction nullability.

The standard dialect emits SQL/JSON `JSON_VALUE` and `JSON_EXISTS` syntax.
PostgreSQL, MySQL, and SQLite use their native JSON policies to preserve the
same result types. The current policies require PostgreSQL 12 or newer, MySQL
8.0.21 or newer, and SQLite JSON functions; an application-created dialect
must provide a JSON renderer; `createDialect()` advertises the `json` capability
automatically when that renderer is present.

JSON paths currently cover deterministic key and index traversal. Wildcards,
filters, recursive descent, JSON-returning extraction, document mutation, and
row expansion remain explicit dialect extensions.

## Use the derived write types

`TableInsertInput` and `TableUpdateInput` expose the same rules to application
code:

```ts
import type { TableInsertInput, TableUpdateInput } from 'qubu'

type AccountInsert = TableInsertInput<typeof accounts.definitions>
type AccountUpdate = TableUpdateInput<typeof accounts.definitions>

const insert: AccountInsert = {
  email: 'ada@example.com',
  externalScore: '10',
}

const update: AccountUpdate = {
  nickname: null,
  externalScore: 10,
}
```

`id` is not accepted in either object because it is generated. `nickname` is
optional on insert because the database supplies a default, but it remains a
valid nullable update field.

Continue with [Write mutations](../guides/mutations.md) to see these types used
by `INSERT`, `UPDATE`, and `DELETE` statements.
