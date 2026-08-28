# Use a Qubu schema with Drizzle

> Derive Drizzle tables at runtime so Qubu and Drizzle queries can share one
> schema declaration during a gradual migration.

## Install the optional integration

Install the integration next to Qubu and Drizzle. The `@qubu/drizzle` package
owns schema conversion; the root `qubu` package does not depend on Drizzle.

```bash
pnpm add qubu @qubu/drizzle drizzle-orm@rc
```

The converter supports PostgreSQL, MySQL, and SQLite with Drizzle 1.0.0-rc.4
and later 1.x releases.

## Convert the schema

Declare tables and the root registry with Qubu, then import the converter for
your database:

```ts
import { integer, schema, table, text } from 'qubu'
import { toPostgresDrizzleSchema } from '@qubu/drizzle/postgres'

const users = table('user_records', {
  id: integer({ generated: true }),
  name: text(),
  nickname: text({ nullable: true }),
})

const appSchema = schema({ users }, { namespace: 'app' })
const drizzleTables = toPostgresDrizzleSchema(appSchema)
```

The import path selects the dialect. Each module imports only its matching
Drizzle core package:

| Database   | Import                   | Converter                   |
| ---------- | ------------------------ | --------------------------- |
| PostgreSQL | `@qubu/drizzle/postgres` | `toPostgresDrizzleSchema()` |
| MySQL      | `@qubu/drizzle/mysql`    | `toMysqlDrizzleSchema()`    |
| SQLite     | `@qubu/drizzle/sqlite`   | `toSqliteDrizzleSchema()`   |

`@qubu/drizzle` exports the shared conversion error and dialect types. It does
not import a dialect core or provide a universal runtime converter.

`drizzleTables.users` is a real Drizzle `PgTable`. The logical `users` key,
physical `user_records` name, `app` namespace, field keys, and physical column
names all come from the Qubu declaration.

Use the converted tables in ordinary Drizzle queries. Table objects do not need
to be passed to `drizzle()`:

```ts
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'

const db = drizzle(pool)

const rows = await db
  .select({ id: drizzleTables.users.id, name: drizzleTables.users.name })
  .from(drizzleTables.users)
  .where(eq(drizzleTables.users.id, 7))
```

Existing Qubu queries can keep importing `users`. Move call sites to
`drizzleTables.users` one at a time without duplicating the table declaration.

### Keep SQLite integer timestamps

Use `sqliteTimestamp()` when an existing SQLite schema stores dates as integer
Unix timestamps and Drizzle must continue reading and writing `Date` values:

```ts
import { schema, table } from 'qubu'
import { sqliteTimestamp, toSqliteDrizzleSchema } from '@qubu/drizzle/sqlite'

const events = table('events', {
  createdAt: sqliteTimestamp({
    mode: 'timestamp',
    defaultFn: () => new Date(),
  }),
})

const drizzleTables = toSqliteDrizzleSchema(schema({ events }))
```

`timestamp` stores Unix seconds and `timestamp_ms` stores Unix milliseconds.
Both modes expose `Date` values through Drizzle. `defaultFn` runs when a
Drizzle insert omits the column; it is runtime behavior and is not emitted as a
database `DEFAULT` or serialized into a Qubu snapshot.

Use Qubu's root `timestamp()` helper for portable schemas. SQLite stores that
portable form as ISO text instead of an integer.

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
equivalent, so each dialect converter rejects it at compile time. Built-in
Qubu columns and `$type()` narrowing use one value type and convert without an
override.

## Runtime metadata

Each dialect adapter maps Qubu storage descriptors to its own Drizzle builders.
It also transfers concrete defaults, generated expressions, common primary and
unique constraints, checks, foreign keys, and indexes. Native storage must
belong to the selected dialect:

```ts
import { nativeColumn, schema, table } from 'qubu'
import { toPostgresDrizzleSchema } from '@qubu/drizzle/postgres'

const records = table('records', {
  handle: nativeColumn('postgresql', 'CITEXT'),
})

const tables = toPostgresDrizzleSchema(schema({ records }))
```

Conversion first runs Qubu's snapshot validation for the selected dialect.
Metadata that Drizzle 1.0 cannot express, such as deferred constraints or
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
