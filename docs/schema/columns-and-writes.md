# Column behavior and write types

> Separate selected values from insert and update inputs, then record the database rules that make fields optional or generated.

## Give each operation its own type

Every column has a selected output type. It can also describe what inserts and
updates accept:

| Option           | Selected output | Insert input      | Update input      |
| ---------------- | --------------- | ----------------- | ----------------- |
| nullable: true   | T or null       | accepts T or null | accepts T or null |
| hasDefault: true | unchanged       | key is optional   | unchanged         |
| generated: true  | unchanged       | key is omitted    | key is omitted    |

Use `column<Output, Insert, Update>()` when the driver returns a different type
from the type the application writes:

```ts
import { column, integer, table, text } from "qubu"

const accounts = table("accounts", {
  id: integer({ generated: true }),
  email: text(),
  nickname: text({ nullable: true, hasDefault: true }),
  externalScore: column<number, string, number>({ nullable: true }),
})
```

The selected `externalScore` is number | null. Inserts accept string | null, and
updates accept number | null.

## Describe defaults and generated columns

The legacy hasDefault and generated flags describe the write contract. Use
complete metadata when schema tooling also needs the database fact:

```ts
import { boolean, generatedColumn, identityColumn, integer, table, text, value } from "qubu"
import { defineSchemaExpression } from "qubu/schema"

const currentTimestamp = defineSchemaExpression("function", (context) => {
  context.append("CURRENT_TIMESTAMP")
})

const accounts = table("accounts", {
  id: integer({ identity: identityColumn("always") }),
  status: text({ default: "pending" }),
  active: boolean({ default: true }),
  score: integer({
    generatedColumn: generatedColumn(value(1), "stored"),
  }),
  createdAt: text({
    default: currentTimestamp,
  }),
})
```

Primitive values in `default` are canonical literals. Strings are never
interpreted as SQL, and booleans remain semantic values so each dialect can
choose its own spelling. Pass a branded deterministic schema expression
directly when the default is SQL, and use `unsafeSchemaSql()` only for trusted
syntax Qubu does not model. Generated expressions record stored or virtual
mode. An identity descriptor stays separate because identity behavior is not
an ordinary generated expression.

Complete defaults cannot be combined with generated or identity metadata.
Contradictory flags fail with a structured `ColumnBehaviorError`. Use
`externalDefault()` or `externalGeneratedColumn()` when another schema authority
owns the missing detail.

Dialect-owned identity details stay on the identity descriptor. SQLite's
autoIncrement requires an exact INTEGER rowid alias that is the sole column of
a primary key. MySQL's AUTO_INCREMENT is a column-level identity extension, and
MySQL's ON UPDATE clause accepts a branded deterministic expression. The
database-specific restrictions are listed in the
[snapshot overview](snapshots.md) and its dialect matrices.

## Narrow an application type

Use `$type<T>()` to narrow a helper's TypeScript type without changing its
runtime column definition:

```ts
import { table, text } from "qubu"

const users = table("users", {
  status: text().$type<"active" | "disabled">(),
})
```

The narrowed type applies to selected values and insert and update inputs. It
does not validate values at runtime or add a database constraint.

## Derive write input types

`TableInsertInput` and `TableUpdateInput` expose the same rules to application
code. The following example uses the accounts table from the earlier example:

```ts
import type { TableInsertInput, TableUpdateInput } from "qubu"

type AccountInsert = TableInsertInput<typeof accounts.definitions>
type AccountUpdate = TableUpdateInput<typeof accounts.definitions>

const insert: AccountInsert = {
  email: "ada@example.com",
  externalScore: "10",
}

const update: AccountUpdate = {
  nickname: null,
  externalScore: 10,
}
```

`id` is not accepted because it is generated. `nickname` is optional on insert
because the database supplies a default, but it remains a valid nullable update
field.

Continue with [Write mutations](../guides/mutations.md) for typed INSERT,
UPDATE, and DELETE statements.
