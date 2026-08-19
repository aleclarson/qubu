# Schema and type metadata

> Describe application values, write contracts, nullability, and SQL semantics once, then let Qubu preserve each fact through query composition.

`table()` definitions are query-facing schema metadata. They are not database
introspection and they do not create or migrate a database.

## Register tables under stable IDs

Use `schema()` when several table declarations belong to one database model.
The record keys become logical table IDs. They stay stable when a table's
physical SQL name changes:

```ts
import { integer, schema, table, text } from 'qubu'

const accounts = table('account_records', {
  id: integer(),
  email: text(),
})
const memberships = table('membership_records', {
  accountId: integer(),
})

const appSchema = schema({ accounts, memberships }, { namespace: 'public' })
```

`appSchema.registry.accounts.id` is `"accounts"`, while its physical name is
`"account_records"`. The original table remains the query source, so
registering it does not change SQL rendering or row and mutation types. The
namespace belongs to schema metadata and is not added to ordinary queries.

The registry is immutable and its IDs do not depend on record insertion order.
Qubu validates duplicate IDs, duplicate physical names, invalid namespaces,
and collisions in generated names before returning the model. A failed
registry construction throws `SchemaValidationError`; inspect its
`diagnostics` array to report every invalid path to the caller.

The built-in generated-name policy is versioned. `generatedTableName('userId')`
returns `user_id` under policy version 1. Explicit names passed to `table()`
remain unchanged. The policy version and materialized table names give future
snapshot encoders stable input without changing TypeScript source identity.

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

## Describe database defaults and generated columns

The legacy `hasDefault` and `generated` options remain useful write-contract
flags. When schema tooling needs the database fact itself, use the complete
metadata options. A complete default makes its insert key optional; a complete
generated or identity descriptor omits the key from inserts and updates:

```ts
import {
  defaultExpression,
  defaultLiteral,
  defineSchemaExpression,
  generatedColumn,
  identityColumn,
  integer,
  table,
  text,
  value,
} from 'qubu'

const currentTimestamp = defineSchemaExpression('function', context => {
  context.append('CURRENT_TIMESTAMP')
})

const accounts = table('accounts', {
  id: integer({ identity: identityColumn('always') }),
  status: text({ default: defaultLiteral('pending') }),
  score: integer({
    generatedColumn: generatedColumn(value(1), 'stored'),
  }),
  createdAt: text({
    default: defaultExpression(currentTimestamp),
  }),
})
```

`defaultLiteral()` stores a canonical, dialect-neutral literal node. Use
`defaultExpression()` for a branded deterministic schema expression; Qubu
does not render it while declaring the column, so a future dialect adapter can
apply its own literal and expression rules. Generated expressions record
`stored` or `virtual` mode. `identityColumn('always' | 'by-default')` is kept
separate because identity behavior is not an ordinary generated expression.

Legacy flags without a complete descriptor are retained as explicit external
metadata. This records that the database or another schema authority owns the
detail; `externalDefault()` and `externalGeneratedColumn()` make that marker
explicit when constructing metadata directly. Qubu does not invent reproducible
DDL. Complete defaults cannot be
combined with generated or identity metadata, and contradictory flags fail
with a structured `ColumnBehaviorError` before the column is returned.

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

## Use deterministic schema expressions

Schema SQL is a different rendering boundary from a query. Built-in scalar
expressions such as column references, comparisons, boolean composition,
arithmetic, string helpers, and JSON scalar reads carry a deterministic brand
and can be rendered in a declaration context:

```ts
import { eq, renderSchemaSql, table, text } from 'qubu'

const accounts = table('accounts', { status: text() })

renderSchemaSql(eq(accounts.status, 'active'), { mode: 'check' })
// ("status" = 'active')
```

The schema context turns Qubu value expressions into SQL literals, never
placeholders. Strings use SQL quote escaping; finite numbers, booleans,
`bigint`, and `NULL` are supported by the portable fallback. A dialect can
provide `renderSchemaLiteral` to own a different literal spelling. Unsupported
JavaScript values and direct calls to `parameter()` fail instead of being
silently rewritten after rendering.

Column references are emitted as bare physical identifiers for generated,
check, and index expressions. Default expressions reject column references,
because a column default cannot depend on another row value. Aggregates,
windows, and subqueries are rejected in every schema mode.

An extension must explicitly implement the schema contract:

```ts
import { defineSchemaExpression, renderSchemaSql } from 'qubu'

const currentDate = defineSchemaExpression('function', context => {
  context.append('CURRENT_DATE')
})

renderSchemaSql(currentDate, { mode: 'default' })
```

Use `unsafeSchemaSql(dialect, sql)` only for trusted, parameter-free syntax
that Qubu does not model. Its dialect tag is checked at render time, and its
text is preserved apart from converting CRLF/CR line endings to LF. Ordinary
`makeExpression()` extensions are not accepted until wrapped with the
explicit `schemaExpression()` audit boundary.

## Declare logical constraints and indexes

Use the metadata callback when the application schema knows which constraints
and indexes the database enforces. Qubu retains this metadata for type checks
and inspection. It does not emit DDL or migrate the database:

```ts
import {
  check,
  eq,
  foreignKey,
  index,
  integer,
  primaryKey,
  references,
  table,
  text,
  unique,
  uniqueConstraint,
  value,
} from 'qubu'

const tenants = table('tenants', { id: integer(), slug: text() }, tenants => ({
  constraints: { tenantsPrimary: primaryKey(tenants.id) },
  indexes: {
    tenantsSlugIndex: index([tenants.slug], { unique: true }),
  },
}))

const memberships = table(
  'memberships',
  {
    id: integer(),
    tenantId: integer(),
    slug: text(),
    displayName: text(),
  },
  memberships => ({
    constraints: {
      membershipsPrimary: primaryKey(memberships.id),
      membershipsSlugUnique: unique(memberships.tenantId, memberships.slug),
      membershipsTenantForeign: foreignKey(
        [memberships.tenantId],
        references(tenants, tenants.id)
      ),
      membershipsSlugCheck: check(eq(memberships.slug, value('public'))),
    },
    indexes: {
      membershipsTenantSlug: index([memberships.tenantId, memberships.slug], {
        unique: true,
      }),
      publicMemberships: index([memberships.slug], {
        where: eq(memberships.slug, value('public')),
      }),
    },
  })
)
```

The metadata callback receives the preliminary table, including its typed
columns. Give every item a stable application name in the `constraints` or
`indexes` record. Keys and indexes preserve their exact column or expression
tuples. Index terms may use `asc()` or `desc()`. Set `unique: true` for a
unique index, `where` for a partial index, and `include` for columns stored in
the index payload but not used as ordered key terms.

The record key is the logical object ID. `table()` materializes that ID as
`constraint.id` or `index.id` and resolves `physicalName` from the explicit
option or the version-one snake-case naming policy. These identity properties
are read-only metadata; legacy enumerable constraint and index shapes remain
unchanged. Physical names must be unique within their metadata kind.

All columns in one key must come from the callback table, and they must be
non-nullable in the Qubu definition. This matters for
`unique()` because SQL unique constraints commonly allow multiple rows whose
key contains `NULL`; such a key cannot prove that one group determines the
remaining columns. Qubu rejects nullable key declarations instead of making a
dialect-specific assumption.

Use `uniqueConstraint()` when the database enforces uniqueness but the rule is
not a Qubu candidate-key proof. It accepts nullable columns and records the
database's NULL behavior explicitly:

```ts
const accounts = table(
  'accounts',
  {
    email: text({ nullable: true }),
  },
  accounts => ({
    constraints: {
      emailUnique: uniqueConstraint(accounts.email, {
        nulls: 'distinct',
        physicalName: 'accounts_email_key',
      }),
    },
    indexes: {},
  })
)
```

`nulls: 'distinct'` describes the common rule where multiple NULLs do not
conflict; `'not-distinct'` describes a rule where NULL participates in the
uniqueness comparison. Neither form proves that a grouped column determines
the rest of a row. Keep using `unique()` for the stricter, non-null candidate
key declaration used by grouping and foreign-key type proofs.

`foreignKey(localColumns, target, options)` accepts single or composite
tuples. Build a target with `references(table, ...columns)`. The local tuple
must belong to the callback table, both tuples must have the same length, and
each position must have the same known `SqlSemanticType` identity. `SqlUnknown`
cannot prove a foreign-key match. The target tuple must exactly match a
primary key, `unique()` constraint, or eligible unique index. Standard
`onUpdate`, `onDelete`, `match`, `deferrable`, and `initially` options are
retained as metadata:

```ts
const memberships = table(
  'memberships',
  {
    accountId: integer(),
  },
  memberships => ({
    constraints: {
      accountForeign: foreignKey(
        [memberships.accountId],
        references(accounts, accounts.id),
        { onDelete: 'cascade', onUpdate: 'cascade' }
      ),
    },
    indexes: {},
  })
)
```

Direct self-references use the preliminary callback table. Wrap the target in
a function when two modules import each other's tables:

```ts
const nodes = table(
  'nodes',
  { id: integer(), parentId: integer({ nullable: true }) },
  nodes => ({
    constraints: {
      nodesPrimary: primaryKey(nodes.id),
      parentForeign: foreignKey([nodes.parentId], references(nodes, nodes.id)),
    },
    indexes: {},
  })
)

const tenantForeign = foreignKey([memberships.tenantId], () =>
  references(tenants, tenants.id)
)
```

Checks, index expressions, and partial-index predicates may read only columns
from their callback table. They cannot contain aggregates, window functions,
or subqueries. Check expressions and partial predicates must have the boolean
SQL domain.

Grouping every column in a declared key allows other columns from that same
source to be selected:

```ts
const summary = select(
  { displayName: memberships.displayName, total: count() },
  from(memberships),
  groupBy(memberships.tenantId, memberships.slug)
)
```

A primary key, `unique()` constraint, or eligible unique index supplies the
proof. An eligible unique index is non-partial and contains only non-null
table columns. Nullable, partial, expression, and included-column metadata do
not silently become candidate-key evidence. Database uniqueness and Qubu's
functional-dependency proof are deliberately separate concepts.

Index methods, operator classes, concurrency, storage parameters, and MySQL
algorithm/locking settings belong in the typed `dialect` extension on an
index. Constraint extensions follow the same pattern. Portable metadata stays
available to every adapter, while a dialect validator reports a structured
diagnostic for an extension or option that the selected engine cannot support.

The proof follows a table alias and remains source-local through a join,
including a source made nullable by `leftJoin()`. It does not cross a derived
query, CTE, lateral query, or custom-source boundary. Those relations can
change cardinality or projection semantics, so grouping their apparent key
still requires an explicit proof on that source model.

## JavaScript and SQL types are separate

The first-party helpers declare both the application value and a portable SQL
semantic domain without dictating how a driver encodes either one:

| Helper                      | Application type    | SQL domain     |
| --------------------------- | ------------------- | -------------- |
| `integer()`                 | `number`            | `SqlInteger`   |
| `numeric()`                 | `number`            | `SqlDecimal`   |
| `text()`                    | `string`            | `SqlText`      |
| `uuid()`                    | `string`            | `SqlUuid`      |
| `boolean()`                 | `boolean`           | `SqlBoolean`   |
| `date()`                    | `Date`              | `SqlDate`      |
| `timestamp()`, `dateTime()` | `Date`              | `SqlTimestamp` |
| `json<T>()`                 | caller-supplied `T` | `SqlJson<T>`   |
| `bigint()`                  | `bigint`            | `SqlBigInt`    |
| `binary()`, `blob()`        | `Uint8Array`        | `SqlBinary`    |

The driver adapter remains responsible for database-specific encoding and row
decoding. A `timestamp()` column describes the TypeScript value and portable
SQL domain; it does not choose a wire format for a particular database client.

The same definitions are typed cast targets. `cast(value, text())` derives a
`string`/`SqlText` result and lets the active dialect choose the concrete type
spelling. Cast nullability comes from `value`, so schema definitions carrying
`nullable`, `hasDefault`, or `generated` flags are not cast targets.

## Physical storage is a separate axis

Column definitions also retain the physical storage category used by schema
tooling. Built-in helpers use portable descriptors:

| Helpers                     | Portable storage |
| --------------------------- | ---------------- |
| `integer()`                 | `integer`        |
| `numeric()`                 | `numeric`        |
| `text()`                    | `text`           |
| `boolean()`                 | `boolean`        |
| `date()`                    | `date`           |
| `timestamp()`, `dateTime()` | `timestamp`      |
| `uuid()`                    | `uuid`           |
| `json<T>()`                 | `json`           |
| `bigint()`                  | `bigint`         |
| `binary()`, `blob()`        | `binary`         |

The storage category does not replace the application value type, SQL
semantic domain, or cast target. For example, `numeric()` decodes to a
`number`, carries `SqlDecimal`, has portable storage `numeric`, and uses the
logical `decimal` cast target. These facts can change independently.

Use a dialect-native descriptor when a custom column needs an exact vendor
declaration. The dialect tag keeps that declaration from being mistaken for a
portable spelling:

```ts
import { nativeColumn, nativeStorage, table } from 'qubu'

const accounts = table('accounts', {
  handle: nativeColumn(nativeStorage('postgres', 'citext COLLATE "C"')),
})
```

`nativeStorage()` preserves the declaration text exactly and freezes the
descriptor. `ColumnStorageOf<typeof accounts.definitions.handle>` extracts the descriptor;
`ColumnStorageTypeOf`, `ColumnStorageDialectOf`, and
`ColumnStorageDeclarationOf` extract its portable category or native details.
Native metadata is descriptive only. It does not change selection, mutation,
or query rendering behavior.

This distinction matters even when JavaScript types match. `text()` and
`uuid()` both decode to `string`, but UUID supports portable equality rather
than text functions or ordering. Read [SQL semantic types](sql-semantic-types.md)
for capability checks, propagation, contextual literals, and compatibility
boundaries.

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
