import { eq as drizzleEq } from 'drizzle-orm'
import { drizzle as pgDrizzle } from 'drizzle-orm/node-postgres'
import { getTableConfig as getMysqlTableConfig } from 'drizzle-orm/mysql-core'
import { getTableConfig as getPgTableConfig } from 'drizzle-orm/pg-core'
import { getTableConfig as getSqliteTableConfig } from 'drizzle-orm/sqlite-core'
import { expect, test } from 'vitest'
import { DrizzleSchemaConversionError } from 'qubu/drizzle'
import { toMysqlDrizzleSchema } from 'qubu/drizzle/mysql'
import { toPostgresDrizzleSchema } from 'qubu/drizzle/postgres'
import { toSqliteDrizzleSchema } from 'qubu/drizzle/sqlite'
import {
  bigint,
  binary,
  boolean,
  check,
  column,
  date,
  eq,
  foreignKey,
  index,
  identityColumn,
  integer,
  json,
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
} from '../src/index.ts'

const portable = table('portable_values', {
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

test('builds dialect columns with Qubu physical storage and driver mappings', () => {
  const appSchema = schema({ portable })
  const postgres = toPostgresDrizzleSchema(appSchema)
  const mysql = toMysqlDrizzleSchema(appSchema)
  const sqlite = toSqliteDrizzleSchema(appSchema)

  expect(
    getPgTableConfig(postgres.portable).columns.map(column =>
      column.getSQLType().toUpperCase()
    )
  ).toEqual([
    'INTEGER',
    'NUMERIC',
    'TEXT',
    'BOOLEAN',
    'DATE',
    'TIMESTAMP',
    'UUID',
    'JSONB',
    'BIGINT',
    'BYTEA',
  ])
  expect(
    getMysqlTableConfig(mysql.portable).columns.map(column =>
      column.getSQLType().toUpperCase()
    )
  ).toEqual([
    'INT',
    'DECIMAL',
    'TEXT',
    'BOOLEAN',
    'DATE',
    'DATETIME',
    'CHAR(36)',
    'JSON',
    'BIGINT',
    'VARBINARY',
  ])
  expect(
    getSqliteTableConfig(sqlite.portable).columns.map(column =>
      column.getSQLType().toUpperCase()
    )
  ).toEqual([
    'INTEGER',
    'NUMERIC',
    'TEXT',
    'INTEGER',
    'TEXT',
    'TEXT',
    'TEXT',
    'TEXT',
    'INTEGER',
    'BLOB',
  ])

  const instant = new Date('2026-08-23T12:34:56.000Z')
  expect(sqlite.portable.timestamp.mapToDriverValue(instant)).toBe(
    '2026-08-23T12:34:56.000Z'
  )
  expect(
    sqlite.portable.timestamp.mapFromDriverValue('2026-08-23T12:34:56.000Z')
  ).toEqual(instant)
  expect(sqlite.portable.bigint.mapFromDriverValue('42')).toBe(42n)
  expect(postgres.portable.numeric.mapFromDriverValue('12.5')).toBe(12.5)
  expect(mysql.portable.bigint.mapFromDriverValue('42')).toBe(42n)
})

test('preserves logical keys, SQL names, namespaces, and Drizzle query behavior', () => {
  const users = table('user_records', {
    id: integer({ sqlName: 'user_id' }),
    displayName: text(),
    nickname: text({ nullable: true }),
  })
  const converted = toPostgresDrizzleSchema(
    schema({ users }, { namespace: 'app' })
  )
  const config = getPgTableConfig(converted.users)

  expect(config.name).toBe('user_records')
  expect(config.schema).toBe('app')
  expect(config.columns.map(column => column.name)).toEqual([
    'user_id',
    'display_name',
    'nickname',
  ])
  expect(config.columns.map(column => column.notNull)).toEqual([
    true,
    true,
    false,
  ])

  const db = pgDrizzle.mock({ schema: converted })
  expect(
    db
      .select({ id: converted.users.id })
      .from(converted.users)
      .where(drizzleEq(converted.users.id, 7))
      .toSQL()
  ).toEqual({
    sql: 'select "user_id" from "app"."user_records" where "app"."user_records"."user_id" = $1',
    params: [7],
  })
})

test('materializes defaults, generated columns, constraints, and indexes', () => {
  const accounts = table(
    'account_records',
    {
      id: integer(),
      email: text(),
      score: numeric({ default: 1 }),
      normalizedEmail: text({
        generatedColumn: {
          kind: 'expression',
          expression: value('normalized'),
          mode: 'stored',
        },
      }),
    },
    account => ({
      constraints: {
        primary: primaryKey(account.id, { physicalName: 'account_pk' }),
        emailUnique: unique(account.email, {
          physicalName: 'account_email_unique',
        }),
        positiveScore: check(eq(account.score, value(1)), {
          physicalName: 'account_score_check',
        }),
      },
      indexes: {
        emailIndex: index([account.email], {
          physicalName: 'account_email_idx',
        }),
      },
    })
  )
  const memberships = table(
    'membership_records',
    { id: integer(), accountId: integer() },
    membership => ({
      constraints: {
        accountForeign: foreignKey(
          [membership.accountId],
          references(accounts, accounts.id),
          {
            physicalName: 'membership_account_fk',
            onDelete: 'cascade',
          }
        ),
      },
      indexes: {},
    })
  )

  const converted = toPostgresDrizzleSchema(schema({ memberships, accounts }))
  const accountConfig = getPgTableConfig(converted.accounts)
  const membershipConfig = getPgTableConfig(converted.memberships)

  expect(converted.accounts.score.hasDefault).toBe(true)
  expect(converted.accounts.score.default).toBe(1)
  expect(converted.accounts.normalizedEmail.generated).toMatchObject({
    mode: 'stored',
    type: 'always',
  })
  expect(accountConfig.primaryKeys).toHaveLength(1)
  expect(accountConfig.uniqueConstraints).toHaveLength(1)
  expect(accountConfig.checks).toHaveLength(1)
  expect(accountConfig.indexes).toHaveLength(1)
  expect(membershipConfig.foreignKeys).toHaveLength(1)
  expect(membershipConfig.foreignKeys[0].reference().foreignTable).toBe(
    converted.accounts
  )
  expect(membershipConfig.foreignKeys[0].onDelete).toBe('cascade')
})

test('uses SQLite inline primary-key metadata for autoincrement identities', () => {
  const records = table(
    'identity_records',
    {
      id: integer({
        identity: identityColumn('by-default', {
          dialect: { dialect: 'sqlite', autoIncrement: true },
        }),
      }),
    },
    row => ({
      constraints: { primary: primaryKey(row.id) },
      indexes: {},
    })
  )
  const converted = toSqliteDrizzleSchema(schema({ records }))
  const config = getSqliteTableConfig(converted.records)

  expect(converted.records.id.primary).toBe(true)
  expect(
    (converted.records.id as unknown as { autoIncrement: boolean })
      .autoIncrement
  ).toBe(true)
  expect(config.primaryKeys).toHaveLength(0)
})

test('reports storage and Drizzle metadata that cannot be converted', () => {
  const missingStorage = schema({
    values: table('missing_storage', { value: column<number>() }),
  })

  expect(() => toPostgresDrizzleSchema(missingStorage as never)).toThrow(
    DrizzleSchemaConversionError
  )

  const deferred = table('deferred_values', { id: integer() }, row => ({
    constraints: {
      primary: primaryKey(row.id, { deferrable: true }),
    },
    indexes: {},
  }))

  expect(() => toPostgresDrizzleSchema(schema({ deferred }))).toThrow(
    /cannot represent deferred constraint/
  )
})
