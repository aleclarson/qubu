# Schema and type metadata

> Describe the application-facing values of a table once, then let Qubu derive selected row, insert, and update types from that description.

`table()` definitions are query-facing schema metadata. They are not database
introspection and they do not create or migrate a database.

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
