# Tables and names

> Define query-facing tables, keep their TypeScript identities stable, and control how fields become SQL names.

`table()` definitions describe the columns Qubu can select and write. They are
not database introspection and they do not create or migrate a database.

## Register tables under stable IDs

Use `schema()` when several table declarations belong to one database model. The
record keys become logical table IDs and stay stable when a physical SQL name
changes:

```ts
import { integer, schema, table, text } from "qubu"

const accounts = table("account_records", {
  id: integer(),
  email: text(),
})
const memberships = table("membership_records", {
  accountId: integer(),
})

const appSchema = schema({ accounts, memberships }, { namespace: "public" })
```

appSchema.registry.accounts.id is "accounts", while the physical table name is
"account_records". Registering the table does not change its query source, SQL
rendering, or row and mutation types. The namespace belongs to schema metadata
and is not added to ordinary queries.

The registry is immutable. Qubu validates duplicate IDs, duplicate physical
names, invalid namespaces, and collisions in generated names before returning
the model. A failed registry construction throws `SchemaValidationError`; its
diagnostics array contains every invalid path.

The generated-name policy is versioned. Import `generatedTableName()` from
`qubu/schema` when a schema tool needs to preview the policy. It returns
`user_id` for `userId` under policy version 1. Explicit names passed to
`table()` remain unchanged. The policy gives snapshot encoders stable names
without changing TypeScript source identity.

## Map field names to SQL

Write schema keys in camelCase. Qubu converts them to snake_case in SQL, then
uses the camelCase keys in the returned row:

```ts
import { from, select, table, timestamp, uuid } from "qubu"

const events = table("events", {
  userId: uuid(),
  createdAt: timestamp(),
})

const query = select({ userId: events.userId, createdAt: events.createdAt }, from(events))
```

The query selects "events"."user_id" and "events"."created_at", then aliases
them as "userId" and "createdAt" for the returned row. Inserts and updates
accept the same camelCase keys.

Acronym boundaries are preserved:

| TypeScript key | SQL name         |
| -------------- | ---------------- |
| userID         | user_id          |
| APIKey         | api_key          |
| XMLHttpRequest | xml_http_request |

Prefer `userId` and `apiKey` when you control the TypeScript name. Use `sqlName` when
the database name does not follow the convention:

```ts
const events = table("events", {
  createdAt: timestamp({ sqlName: "creation_timestamp" }),
})
```

Qubu rejects fields that resolve to the same SQL name, such as `userId` and
userID in one table.

CTEs, derived tables, lateral queries, and subqueries remain SQL relations, so
their projected names stay snake_case. Only the outer result projection uses
camelCase aliases. Pass the database relation name explicitly:

```ts
import { table, uuid } from "qubu"

const accounts = table("user_accounts", {
  id: uuid(),
})
```

## Read next

- [Column behavior and write types](columns-and-writes.md) covers nullability,
  defaults, generated columns, and application types.
- [Constraints, keys, and indexes](constraints-and-indexes.md) covers the
  metadata used by grouping and schema checks.
- [Storage and schema SQL](storage-and-schema-sql.md) covers physical storage
  and deterministic schema expressions.
