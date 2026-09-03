import { DrizzleSchemaConversionError } from "@qubu/drizzle"
import * as mysqlDrizzle from "@qubu/drizzle/mysql"
import * as postgresDrizzle from "@qubu/drizzle/postgres"
import * as sqliteDrizzle from "@qubu/drizzle/sqlite"
import { eq as drizzleEq, type SQL } from "drizzle-orm"
import { getTableConfig as getMysqlTableConfig } from "drizzle-orm/mysql-core"
import { drizzle as mysqlProxyDrizzle } from "drizzle-orm/mysql-proxy"
import { drizzle as pgDrizzle } from "drizzle-orm/node-postgres"
import { getTableConfig as getPgTableConfig, PgDialect } from "drizzle-orm/pg-core"
import { getTableConfig as getSqliteTableConfig } from "drizzle-orm/sqlite-core"
import { drizzle as sqliteProxyDrizzle } from "drizzle-orm/sqlite-proxy"
import {
  bigint,
  binary,
  boolean,
  check,
  column,
  desc,
  date,
  eq,
  foreignKey,
  generatedColumn,
  index,
  identityColumn,
  integer,
  json,
  nativeColumn,
  numeric,
  primaryKey,
  references,
  schema,
  table,
  text,
  timestamp,
  unique,
  uuid,
  value,
} from "qubu"
import { defineSchemaExpression } from "qubu/schema"
import { sqliteTimestamp } from "qubu/sqlite"
import { expect, test } from "vitest"

const portable = table("portable_values", {
  integer: integer(),
  numeric: numeric(),
  text: text(),
  boolean: boolean(),
  date: date(),
  timestamp: timestamp(),
  uuid: uuid(),
  json: json<{ ok: boolean }>(),
  bigint: bigint(),
  binary: binary(),
})

test("builds dialect columns with Qubu physical storage and value modes", () => {
  const appSchema = schema({ portable })
  const postgres = postgresDrizzle.toDrizzleSchema(appSchema)
  const mysql = mysqlDrizzle.toDrizzleSchema(appSchema)
  const sqlite = sqliteDrizzle.toDrizzleSchema(appSchema)

  expect(
    getPgTableConfig(postgres.portable).columns.map((column) => column.getSQLType().toUpperCase()),
  ).toEqual([
    "INTEGER",
    "NUMERIC",
    "TEXT",
    "BOOLEAN",
    "DATE",
    "TIMESTAMP",
    "UUID",
    "JSONB",
    "BIGINT",
    "BYTEA",
  ])
  expect(
    getMysqlTableConfig(mysql.portable).columns.map((column) => column.getSQLType().toUpperCase()),
  ).toEqual([
    "INT",
    "DECIMAL",
    "TEXT",
    "BOOLEAN",
    "DATE",
    "DATETIME",
    "CHAR(36)",
    "JSON",
    "BIGINT",
    "VARBINARY",
  ])
  expect(
    getSqliteTableConfig(sqlite.portable).columns.map((column) =>
      column.getSQLType().toUpperCase(),
    ),
  ).toEqual([
    "INTEGER",
    "NUMERIC",
    "TEXT",
    "INTEGER",
    "TEXT",
    "TEXT",
    "TEXT",
    "TEXT",
    "INTEGER",
    "BLOB",
  ])

  const instant = new Date("2026-08-23T12:34:56.000Z")

  expect(sqlite.portable.timestamp.mapToDriverValue(instant)).toBe("2026-08-23T12:34:56.000Z")
  expect(sqlite.portable.timestamp.mapFromDriverValue("2026-08-23T12:34:56.000Z")).toEqual(instant)
  expect(sqlite.portable.bigint.mapFromDriverValue("42")).toBe(42n)
  expect((postgres.portable.numeric as unknown as { codec: string }).codec).toBe("numeric:number")
  expect((mysql.portable.bigint as unknown as { codec: string }).codec).toBe("bigint")
})

test("preserves SQLite integer timestamp codecs and runtime defaults", () => {
  const instant = new Date("2026-08-27T12:34:56.000Z")
  const records = table("timestamp_records", {
    createdAt: sqliteTimestamp({ defaultFn: () => instant }),
    updatedAt: sqliteTimestamp({ mode: "timestamp_ms" }),
  })
  const converted = sqliteDrizzle.toDrizzleSchema(schema({ records }))
  const db = sqliteProxyDrizzle(async () => ({ rows: [] }))

  expect(converted.records.createdAt.getSQLType().toUpperCase()).toBe("INTEGER")
  expect(converted.records.createdAt.mapToDriverValue(instant)).toBe(instant.getTime() / 1_000)
  expect(converted.records.createdAt.mapFromDriverValue(instant.getTime() / 1_000)).toEqual(instant)
  expect(converted.records.updatedAt.mapToDriverValue(instant)).toBe(instant.getTime())
  expect(db.insert(converted.records).values({ updatedAt: instant }).toSQL()).toEqual({
    sql: 'insert into "timestamp_records" ("created_at", "updated_at") values (?, ?)',
    params: [instant.getTime() / 1_000, instant.getTime()],
  })
})

test("preserves logical keys, SQL names, namespaces, and Drizzle query behavior", () => {
  const users = table("user_records", {
    id: integer({ sqlName: "user_id" }),
    displayName: text(),
    nickname: text({ nullable: true }),
  })
  const converted = postgresDrizzle.toDrizzleSchema(schema({ users }, { namespace: "app" }))
  const config = getPgTableConfig(converted.users)

  expect(config.name).toBe("user_records")
  expect(config.schema).toBe("app")
  expect(config.columns.map((column) => column.name)).toEqual([
    "user_id",
    "display_name",
    "nickname",
  ])
  expect(config.columns.map((column) => column.notNull)).toEqual([true, true, false])

  const db = pgDrizzle.mock()

  expect(
    db
      .select({ id: converted.users.id })
      .from(converted.users)
      .where(drizzleEq(converted.users.id, 7))
      .toSQL(),
  ).toEqual({
    sql: 'select "user_id" from "app"."user_records" where "app"."user_records"."user_id" = $1',
    params: [7],
  })
})

test("materializes defaults, generated columns, constraints, and indexes", () => {
  const accounts = table(
    "account_records",
    {
      id: integer(),
      email: text(),
      score: numeric({ default: 1 }),
      normalizedEmail: text({
        generatedColumn: {
          kind: "expression",
          expression: value("normalized"),
          mode: "stored",
        },
      }),
    },
    (account) => ({
      constraints: {
        primary: primaryKey(account.id, { physicalName: "account_pk" }),
        emailUnique: unique(account.email, {
          physicalName: "account_email_unique",
        }),
        positiveScore: check(eq(account.score, value(1)), {
          physicalName: "account_score_check",
        }),
      },
      indexes: {
        emailIndex: index([account.email], {
          physicalName: "account_email_idx",
        }),
      },
    }),
  )
  const memberships = table(
    "membership_records",
    {
      id: integer(),
      accountId: integer(),
    },
    (membership) => ({
      constraints: {
        accountForeign: foreignKey([membership.accountId], references(accounts, accounts.id), {
          physicalName: "membership_account_fk",
          onDelete: "cascade",
        }),
      },
      indexes: {},
    }),
  )

  const converted = postgresDrizzle.toDrizzleSchema(
    schema({
      memberships,
      accounts,
    }),
  )
  const accountConfig = getPgTableConfig(converted.accounts)
  const membershipConfig = getPgTableConfig(converted.memberships)

  expect(converted.accounts.score.hasDefault).toBe(true)
  expect(converted.accounts.score.default).toBe(1)
  expect(converted.accounts.normalizedEmail.generated).toMatchObject({
    mode: "stored",
    type: "always",
  })
  expect(accountConfig.primaryKeys).toHaveLength(1)
  expect(accountConfig.uniqueConstraints).toHaveLength(1)
  expect(accountConfig.checks).toHaveLength(1)
  expect(accountConfig.indexes).toHaveLength(1)
  expect(membershipConfig.foreignKeys).toHaveLength(1)
  expect(membershipConfig.foreignKeys[0].reference().foreignTable).toBe(converted.accounts)
  expect(membershipConfig.foreignKeys[0].onDelete).toBe("cascade")
})

test("uses SQLite inline primary-key metadata for autoincrement identities", () => {
  const records = table(
    "identity_records",
    {
      id: integer({
        identity: identityColumn("by-default", {
          dialect: {
            dialect: "sqlite",
            autoIncrement: true,
          },
        }),
      }),
    },
    (row) => ({
      constraints: { primary: primaryKey(row.id) },
      indexes: {},
    }),
  )
  const converted = sqliteDrizzle.toDrizzleSchema(schema({ records }))
  const config = getSqliteTableConfig(converted.records)

  expect(converted.records.id.primary).toBe(true)
  expect((converted.records.id as unknown as { autoIncrement: boolean }).autoIncrement).toBe(true)
  expect(config.primaryKeys).toHaveLength(0)
})

test("reports storage and Drizzle metadata that cannot be converted", () => {
  const missingStorage = schema({
    values: table("missing_storage", { value: column<number>() }),
  })

  expect(() => postgresDrizzle.toDrizzleSchema(missingStorage as never)).toThrow(
    DrizzleSchemaConversionError,
  )

  const deferred = table("deferred_values", { id: integer() }, (row) => ({
    constraints: {
      primary: primaryKey(row.id, { deferrable: true }),
    },
    indexes: {},
  }))

  expect(() => postgresDrizzle.toDrizzleSchema(schema({ deferred }))).toThrow(
    /cannot represent deferred constraint/,
  )
})

test("keeps database-managed defaults out of client runtime defaults", () => {
  const defaults = table("database_defaults", {
    id: integer(),
    value: integer({ hasDefault: true }),
  })
  const appSchema = schema({ defaults })
  const postgres = postgresDrizzle.toDrizzleSchema(appSchema)
  const mysql = mysqlDrizzle.toDrizzleSchema(appSchema)

  expect(postgres.defaults.value.defaultFn).toBeUndefined()
  expect(mysql.defaults.value.defaultFn).toBeUndefined()
  expect(pgDrizzle.mock().insert(postgres.defaults).values({ id: 1 }).toSQL()).toEqual({
    sql: 'insert into "database_defaults" ("id", "value") values ($1, default)',
    params: [1],
  })
  expect(
    mysqlProxyDrizzle(async () => ({ rows: [] }))
      .insert(mysql.defaults)
      .values({ id: 1 })
      .toSQL(),
  ).toEqual({
    sql: "insert into `database_defaults` (`id`, `value`) values (?, default)",
    params: [1],
  })

  expect(() => sqliteDrizzle.toDrizzleSchema(appSchema)).toThrow(
    /cannot safely represent externally managed default metadata/,
  )

  const generated = table("external_generated", {
    id: integer(),
    value: integer({ generated: true }),
  })

  expect(() => postgresDrizzle.toDrizzleSchema(schema({ generated }))).toThrow(
    /cannot safely omit externally managed generated column/,
  )
})

test("omits representable generated columns from Drizzle inserts", () => {
  const records = table("generated_records", {
    id: integer(),
    normalized: text({
      generatedColumn: generatedColumn(value("normalized"), "stored"),
    }),
  })
  const converted = postgresDrizzle.toDrizzleSchema(schema({ records }))

  expect(pgDrizzle.mock().insert(converted.records).values({ id: 1 }).toSQL()).toEqual({
    sql: 'insert into "generated_records" ("id") values ($1)',
    params: [1],
  })
})

test("uses database-owned MySQL ON UPDATE metadata", () => {
  const currentTimestamp = defineSchemaExpression("function", (context) => {
    context.append("CURRENT_TIMESTAMP(3)")
  })
  const records = table("updated_records", {
    updatedAt: timestamp({ onUpdate: currentTimestamp }),
  })
  const converted = mysqlDrizzle.toDrizzleSchema(schema({ records }))
  const [updatedAt] = getMysqlTableConfig(converted.records).columns

  expect(updatedAt).toMatchObject({
    hasOnUpdateNow: true,
    onUpdateNowFsp: 3,
  })
  expect(updatedAt?.onUpdateFn).toBeUndefined()

  const unsupported = table("unsupported_update", {
    updatedAt: timestamp({
      onUpdate: defineSchemaExpression("function", (context) => {
        context.append("CURRENT_DATE")
      }),
    }),
  })

  expect(() => mysqlDrizzle.toDrizzleSchema(schema({ unsupported }))).toThrow(
    /cannot represent ON UPDATE expression/,
  )
})

test("normalizes SQLite timestamps, bigints, and binary values", () => {
  const records = table("sqlite_values", {
    timestamp: timestamp(),
    bigint: bigint(),
    binary: binary(),
  })
  const converted = sqliteDrizzle.toDrizzleSchema(schema({ records }))

  const previousTimezone = process.env.TZ

  process.env.TZ = "America/New_York"
  try {
    expect(converted.records.timestamp.mapFromDriverValue("2026-01-02 03:04:05")).toEqual(
      new Date("2026-01-02T03:04:05.000Z"),
    )
  } finally {
    if (previousTimezone === undefined) {
      delete process.env.TZ
    } else {
      process.env.TZ = previousTimezone
    }
  }

  expect(() => converted.records.timestamp.mapFromDriverValue("2026-02-30 03:04:05")).toThrow(
    /Invalid SQLite timestamp value/,
  )
  expect(converted.records.bigint.mapFromDriverValue(42n)).toBe(42n)
  expect(converted.records.bigint.mapFromDriverValue("9007199254740993")).toBe(9007199254740993n)
  expect(converted.records.bigint.mapFromDriverValue(Number.MAX_SAFE_INTEGER)).toBe(
    BigInt(Number.MAX_SAFE_INTEGER),
  )
  expect(() => converted.records.bigint.mapFromDriverValue(Number.MAX_SAFE_INTEGER + 1)).toThrow(
    /must be a safe integer/,
  )
  expect(() => converted.records.bigint.mapFromDriverValue("1.5")).toThrow(
    /must be an exact decimal integer/,
  )

  const bytes = Uint8Array.from([1, 2, 3])
  const driverBytes = converted.records.binary.mapToDriverValue(bytes)
  const resultBytes = converted.records.binary.mapFromDriverValue(bytes.buffer)

  expect(driverBytes).toBeInstanceOf(Uint8Array)
  expect(driverBytes).toEqual(bytes)
  expect(resultBytes).toBeInstanceOf(Uint8Array)
  expect(resultBytes).toEqual(bytes)
})

test("preserves dialect identities and independent table primary keys", () => {
  const postgresRecords = table("postgres_identities", {
    id: integer({ identity: identityColumn("always") }),
  })
  const mysqlRecords = table(
    "mysql_identities",
    {
      id: integer({
        identity: identityColumn("by-default", {
          dialect: {
            dialect: "mysql",
            autoIncrement: true,
          },
        }),
      }),
    },
    (row) => ({
      constraints: { primary: primaryKey(row.id) },
      indexes: {},
    }),
  )
  const postgres = postgresDrizzle.toDrizzleSchema(schema({ postgresRecords }))
  const mysql = mysqlDrizzle.toDrizzleSchema(schema({ mysqlRecords }))

  expect(postgres.postgresRecords.id.generatedIdentity).toEqual({ type: "always" })
  expect((mysql.mysqlRecords.id as unknown as { autoIncrement: boolean }).autoIncrement).toBe(true)

  const ordinary = table(
    "ordinary_primary_keys",
    {
      left: integer(),
      right: integer(),
    },
    (row) => ({
      constraints: { primary: primaryKey(row.left, row.right) },
      indexes: {},
    }),
  )
  const sqlite = sqliteDrizzle.toDrizzleSchema(schema({ ordinary }))

  expect(getSqliteTableConfig(sqlite.ordinary).primaryKeys).toHaveLength(1)

  const native = table(
    "native_identity",
    {
      id: nativeColumn("mysql", "INT", {
        identity: identityColumn("by-default", {
          dialect: {
            dialect: "mysql",
            autoIncrement: true,
          },
        }),
      }),
    },
    (row) => ({
      constraints: { primary: primaryKey(row.id) },
      indexes: {},
    }),
  )

  expect(() => mysqlDrizzle.toDrizzleSchema(schema({ native }))).toThrow(
    /cannot represent identity metadata/,
  )

  const postgresNative = table("postgres_native_identity", {
    id: nativeColumn("postgresql", "INTEGER", {
      identity: identityColumn("always"),
    }),
  })

  expect(() => postgresDrizzle.toDrizzleSchema(schema({ postgresNative }))).toThrow(
    /cannot represent identity metadata/,
  )
})

test("preserves PostgreSQL index NULLS ordering and rejects it for SQLite", () => {
  const records = table("ordered_records", { value: text() }, (row) => ({
    constraints: {},
    indexes: { valueIndex: index([desc(row.value, "LAST")]) },
  }))
  const postgres = postgresDrizzle.toDrizzleSchema(schema({ records }))
  const indexColumn = getPgTableConfig(postgres.records).indexes[0]?.config.columns[0]

  expect(indexColumn).toBeDefined()
  expect(new PgDialect().sqlToQuery(indexColumn! as SQL)).toEqual({
    sql: '"ordered_records"."value" DESC NULLS LAST',
    params: [],
  })
  expect(() => sqliteDrizzle.toDrizzleSchema(schema({ records }))).toThrow(
    /cannot represent NULLS LAST/,
  )
})
