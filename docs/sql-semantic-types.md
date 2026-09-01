# SQL semantic types

> Use SQL domains to constrain valid query composition without conflating database semantics with driver-decoded application values.

Qubu tracks four independent facts for a field or result expression:

| Fact            | Question it answers                                       | Example                   |
| --------------- | --------------------------------------------------------- | ------------------------- |
| JavaScript type | What value does the driver give the application?          | `string`                  |
| Write types     | What values may an insert or update accept?               | `string`, `Date`, or both |
| Nullability     | Can the selected value be `null`?                         | `false`                   |
| SQL domain      | Which portable SQL operations may consume the expression? | `SqlText` or `SqlUuid`    |

The axes are deliberately separate. Both `text()` and `uuid()` decode to a
JavaScript `string`, but their SQL behavior differs. Likewise, two
`timestamp()` definitions may share `SqlTimestamp` while a custom column uses
different JavaScript output and write types for its driver.

## Built-in domains and capabilities

Schema helpers attach these portable semantic domains:

| Helpers       | SQL domain     | Portable capabilities               |
| ------------- | -------------- | ----------------------------------- |
| `text()`      | `SqlText`      | text, equality, ordering            |
| `uuid()`      | `SqlUuid`      | equality                            |
| `integer()`   | `SqlInteger`   | numeric, equality, numeric ordering |
| `numeric()`   | `SqlDecimal`   | numeric, equality, numeric ordering |
| `boolean()`   | `SqlBoolean`   | equality                            |
| `date()`      | `SqlDate`      | equality, date ordering             |
| `timestamp()` | `SqlTimestamp` | equality, timestamp ordering        |
| `json<T>()`   | `SqlJson<T>`   | no portable comparison capability   |
| `bigint()`    | `SqlBigInt`    | numeric, equality, numeric ordering |
| `binary()`    | `SqlBinary`    | equality                            |

Capabilities describe portable operation families. `SqlTextLike` is accepted
by text functions and pattern matching, `SqlNumericLike` by arithmetic and
numeric aggregates, and `SqlOrderable<Group>` by ordering operations. Equality
and ordering groups allow related domains to interoperate: `SqlInteger` and
`SqlDecimal` share the `numeric` group, for example.

Specific result domains are still retained. `lower(textColumn)` produces
`SqlText`, while `avg(integerColumn)` produces `SqlDecimal`:

```ts
import { avg, integer, lower, table, text } from "qubu"
import type { SqlTypeOf } from "qubu"

const metrics = table("metrics", {
  label: text(),
  sampleCount: integer(),
})

const normalized = lower(metrics.label)
type LowerDomain = SqlTypeOf<typeof normalized>
// SqlText

const mean = avg(metrics.sampleCount)
type MeanDomain = SqlTypeOf<typeof mean>
// SqlDecimal
```

`SqlTypeOf<T>` reads the domain of any result-bearing expression. Named query
projections retain a map of domains through `QuerySqlTypeMap<T>`; aliases,
CTEs, LATERAL sources, scalar subqueries, set operations, and mutation
`RETURNING` projections carry those domains forward.

## UUID is not text-like

A UUID may be decoded as a JavaScript string without acquiring SQL text
semantics. Contextual JavaScript literals remain ergonomic for compatible
operators:

```ts
import { asc, eq, inList, like, lower, orderBy, table, uuid } from "qubu"

const records = table("records", { id: uuid() })

eq(records.id, "108cb836-20d2-41b2-8c23-f0c94700aa7e") // valid
inList(records.id, ["first-id", "second-id"]) // valid

lower(records.id) // TypeScript error: SqlUuid is not SqlTextLike
like(records.id, "%uuid%") // TypeScript error: SqlUuid is not SqlTextLike
orderBy(asc(records.id)) // TypeScript error: SqlUuid is not portably orderable
```

Plain JavaScript operands take their domain from the typed expression in that
operation. This contextual typing does not relabel an expression: comparing a
`SqlUuid` expression with a `SqlText` expression is still rejected. Cast when
the database operation intentionally changes domains:

Scalar text functions bind primitive operands automatically, and `coalesce()`
uses its first expression to type primitive fallbacks:

```ts
upper("Ada") // UPPER(?)
coalesce(metrics.label, "Anonymous") // COALESCE("metrics"."label", ?)
```

```ts
import { cast, like, text } from "qubu"

const idAsText = cast(records.id, text())
like(idAsText, "108c%")
```

Built-in definitions carry logical cast targets, so the active dialect can
render `TEXT`, MySQL `CHAR`, or another configured spelling while the result
remains `string`/`SqlText`. Use a custom definition or `typedCast()` when the
target is vendor-specific.

## Known incompatibility is rejected

Qubu checks capabilities and compatibility when it knows both SQL domains.
Arithmetic and `SUM`/`AVG` require numeric-like expressions; text functions,
concatenation, `LIKE`, and PostgreSQL `ILIKE` require text-like expressions;
ordering and range comparisons require compatible ordering groups; and
equality, `IN`, `CASE`, `COALESCE`, and set-operation fields require compatible
equality groups. Boolean clauses require a boolean SQL domain.

These checks model portable capability and group relationships, not every
database's implicit casts. An expression accepted by one database after an
implicit conversion may therefore need an explicit typed cast in portable
Qubu code.

## Unknown domains preserve compatibility

`column()`, `value()`, `call()`, and untyped custom expressions default to
`SqlUnknown`. Unknown is intentionally permissive, so existing extensions keep
composing while authors adopt semantic types incrementally:

```ts
const legacyId = column<string>()
// ColumnSqlType<typeof legacyId> is SqlUnknown
```

`SqlUnknown` is an escape hatch, not evidence about the database. Prefer a
declared domain for reusable extensions so incompatible composition fails at
the call site. See [Typed expressions](guides/extensions/typed-expressions.md#declare-a-custom-sql-domain)
for custom domains, functions, values, casts, and raw expressions.

## Static metadata is not database proof

SQL semantic domains affect TypeScript only. A definition used explicitly as a
cast target also contributes a logical or named runtime target. Those domains
do not inspect the database, prove a migration safe, select a wire encoding, or
verify that the rendered type name exists. The application remains responsible
for keeping table definitions aligned with the database, and the driver
adapter remains responsible for encoding parameters and decoding rows.
