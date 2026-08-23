# Use a Qubu schema with Drizzle

> Derive Drizzle tables at runtime so Qubu and Drizzle queries can share one
> schema declaration during a gradual migration.

## Install the optional integration

Install Drizzle next to Qubu. The `qubu/drizzle` entrypoint has an optional peer
dependency on Drizzle, so importing the rest of Qubu does not load the ORM.

```bash
pnpm add qubu drizzle-orm
```

The converter supports PostgreSQL, MySQL, and SQLite with Drizzle 0.45.2 through
the current 0.x line.

## Convert the schema

Declare tables and the root registry with Qubu, then pass the registry and its
database dialect to `toDrizzleSchema()`:

```ts
import { integer, schema, table, text } from 'qubu'
import { toDrizzleSchema } from 'qubu/drizzle'

const users = table('user_records', {
  id: integer({ generated: true }),
  name: text(),
  nickname: text({ nullable: true }),
})

const appSchema = schema({ users }, { namespace: 'app' })
const drizzleTables = toDrizzleSchema(appSchema, 'postgresql')
```

`drizzleTables.users` is a real Drizzle `PgTable`. The logical `users` key,
physical `user_records` name, `app` namespace, field keys, and physical column
names all come from the Qubu declaration.

Pass the converted record to Drizzle and use it in ordinary queries:

```ts
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'

const db = drizzle(pool, { schema: drizzleTables })

const rows = await db
  .select({ id: drizzleTables.users.id, name: drizzleTables.users.name })
  .from(drizzleTables.users)
  .where(eq(drizzleTables.users.id, 7))
```

Existing Qubu queries can keep importing `users`. Move call sites to
`drizzleTables.users` one at a time without duplicating the table declaration.

## Type behavior

The converted columns preserve selected values, nullability, required insert
keys, defaults, and generated-column omission:

```ts
type User = typeof drizzleTables.users.$inferSelect
// { id: number; name: string; nickname: string | null }

type NewUser = typeof drizzleTables.users.$inferInsert
// { name: string; nickname: string | null }
```

Qubu requires a nullable insert field unless that field has a default. The
adapter retains that rule even though hand-written Drizzle schemas normally
make nullable fields optional.

Drizzle has one application value type per column. Qubu can instead declare
different select, insert, and update types with
`column<Output, Insert, Update>()`. That declaration has no lossless Drizzle
equivalent, so `toDrizzleSchema()` rejects it at compile time. Built-in Qubu
columns and `$type()` narrowing use one value type and convert without an
override.

## Runtime metadata

The adapter selects Drizzle's PostgreSQL, MySQL, or SQLite builders from the
Qubu storage descriptor. It also transfers concrete defaults, generated
expressions, common primary and unique constraints, checks, foreign keys, and
indexes. Native storage must belong to the selected dialect:

```ts
import { nativeColumn, schema, table } from 'qubu'
import { toDrizzleSchema } from 'qubu/drizzle'

const records = table('records', {
  handle: nativeColumn('postgresql', 'CITEXT'),
})

const tables = toDrizzleSchema(schema({ records }), 'postgresql')
```

Conversion first runs Qubu's snapshot validation for the selected dialect.
Metadata that Drizzle 0.45 cannot express, such as deferred constraints or
included index columns, raises `DrizzleSchemaConversionError` with a `code` and
`path`.

PostgreSQL schemas and MySQL databases become Drizzle table namespaces. Drizzle
SQLite tables have no namespace field, so a Qubu SQLite namespace remains
snapshot metadata and is not attached to the converted table.

> [!IMPORTANT]
> An external default or generated descriptor records that another authority
> owns the SQL definition. The adapter preserves its Drizzle write types but
> cannot invent the missing expression. Keep Qubu snapshots and migration plans
> as the DDL authority while those descriptors remain external.

The returned record contains tables, not Drizzle `relations()` declarations.
Add relations beside the converted record if the application uses Drizzle's
relational query API.
