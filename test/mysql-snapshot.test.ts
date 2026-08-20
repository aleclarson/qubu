import { expect, test } from 'vitest'
import {
  check,
  defaultLiteral,
  defineSchemaExpression,
  desc,
  foreignKey,
  generatedColumn,
  gt,
  identityColumn,
  index,
  integer,
  mysqlDialect,
  nativeColumn,
  primaryKey,
  references,
  schema,
  table,
  text,
  timestamp,
  uniqueConstraint,
  unsafeSchemaSql,
  value,
} from '../src/index.ts'
import {
  createMysqlSchemaSnapshot,
  createSchemaSnapshot,
  decodeSchemaSnapshot,
  encodeSchemaSnapshot,
  mysqlSnapshotAdapter,
  mysqlSnapshotDialect,
  schemaSnapshotDigest,
  tryCreatePostgresSchemaSnapshot,
  tryCreateSqliteSchemaSnapshot,
  tryCreateMysqlSchemaSnapshot,
} from '../src/snapshot/index.ts'

const currentTimestamp = defineSchemaExpression('function', context => {
  context.append('CURRENT_TIMESTAMP')
})

const accounts = table(
  'account_records',
  {
    id: integer({
      identity: identityColumn('by-default', {
        dialect: { dialect: 'mysql', autoIncrement: true },
      }),
    }),
    email: text({ nullable: true, default: defaultLiteral("O'Reilly") }),
    updatedAt: timestamp({ onUpdate: currentTimestamp }),
    slug: text({
      generatedColumn: generatedColumn(value('account'), 'virtual'),
    }),
    handle: nativeColumn('mysql', 'VARCHAR(191)', { nullable: true }),
  },
  account => ({
    constraints: {
      primary: primaryKey(account.id, {
        physicalName: 'account_records_pk',
      }),
      emailConstraint: uniqueConstraint(account.email, {
        physicalName: 'account_records_email_constraint',
        nulls: 'distinct',
        dialect: { dialect: 'mysql', enforced: true },
      }),
      positive: check(gt(account.id, value(0)), {
        physicalName: 'account_records_positive',
        dialect: { dialect: 'mysql', enforced: true },
      }),
    },
    indexes: {
      emailIndex: index([desc(account.email)], {
        physicalName: 'account_records_email_idx',
        dialect: {
          dialect: 'mysql',
          algorithm: 'inplace',
          lock: 'none',
          using: 'btree',
          parser: 'ngram',
          keyBlockSize: 8,
        },
      }),
    },
  })
)

const memberships = table(
  'account_memberships',
  { accountId: integer(), role: text() },
  membership => ({
    constraints: {
      accountForeign: foreignKey(
        [membership.accountId],
        references(accounts, accounts.id),
        {
          onDelete: 'cascade',
          match: 'simple',
          dialect: { dialect: 'mysql', enforced: true },
        }
      ),
    },
    indexes: {},
  })
)

const appSchema = schema({ memberships, accounts }, { namespace: 'app' })

test('serializes MySQL storage, updates, generated modes, constraints, and indexes', () => {
  const snapshot = createMysqlSchemaSnapshot(appSchema)
  const accountsTable = snapshot.tables.find(table => table.id === 'accounts')
  const membershipsTable = snapshot.tables.find(
    table => table.id === 'memberships'
  )

  expect(snapshot.dialect).toEqual(mysqlSnapshotDialect)
  expect(snapshot.namespace).toBe('app')
  expect(accountsTable?.columns).toEqual([
    {
      id: 'email',
      physicalName: 'email',
      nullable: true,
      hasDefault: true,
      generated: false,
      storage: { kind: 'native', dialect: 'mysql', type: 'TEXT' },
      default: {
        kind: 'literal',
        value: { kind: 'string', value: "O'Reilly" },
      },
    },
    {
      id: 'handle',
      physicalName: 'handle',
      nullable: true,
      hasDefault: false,
      generated: false,
      storage: { kind: 'native', dialect: 'mysql', type: 'VARCHAR(191)' },
    },
    {
      id: 'id',
      physicalName: 'id',
      nullable: false,
      hasDefault: false,
      generated: true,
      storage: { kind: 'native', dialect: 'mysql', type: 'INT' },
      identity: {
        kind: 'identity',
        generation: 'by-default',
        dialect: {
          dialect: 'mysql',
          version: 1,
          data: { autoIncrement: true },
        },
      },
    },
    {
      id: 'slug',
      physicalName: 'slug',
      nullable: false,
      hasDefault: false,
      generated: true,
      storage: { kind: 'native', dialect: 'mysql', type: 'TEXT' },
      generatedColumn: {
        kind: 'expression',
        expression: {
          kind: 'expression',
          expressionKind: 'value',
          sql: "'account'",
        },
        mode: 'virtual',
      },
    },
    {
      id: 'updatedAt',
      physicalName: 'updated_at',
      nullable: false,
      hasDefault: false,
      generated: false,
      storage: { kind: 'native', dialect: 'mysql', type: 'DATETIME' },
      onUpdate: {
        kind: 'expression',
        expressionKind: 'function',
        sql: 'CURRENT_TIMESTAMP',
      },
    },
  ])
  expect(accountsTable?.indexes[0]).toMatchObject({
    id: 'emailIndex',
    physicalName: 'account_records_email_idx',
    dialect: {
      dialect: 'mysql',
      version: 1,
      data: {
        algorithm: 'inplace',
        keyBlockSize: 8,
        lock: 'none',
        parser: 'ngram',
        using: 'btree',
      },
    },
  })
  expect(membershipsTable?.constraints[0]).toMatchObject({
    kind: 'foreign-key',
    target: { table: 'accounts', columns: ['id'] },
    onDelete: 'cascade',
    match: 'simple',
  })
  expect(schemaSnapshotDigest(snapshot)).toMatch(/^fnv1a64:[0-9a-f]{16}$/)
})

test('keeps MySQL canonical bytes independent of registry order', () => {
  const reordered = schema({ accounts, memberships }, { namespace: 'app' })
  const first = encodeSchemaSnapshot(createMysqlSchemaSnapshot(appSchema))
  const second = encodeSchemaSnapshot(createMysqlSchemaSnapshot(reordered))

  expect(second).toBe(first)
  expect(schemaSnapshotDigest(first)).toBe(schemaSnapshotDigest(second))
})

test('uses MySQL literals and preserves exact native declarations', () => {
  const native = table('native_types', {
    amount: nativeColumn('mysql', 'DECIMAL(10, 2) UNSIGNED'),
    enabled: text({ default: defaultLiteral(true) }),
  })
  const snapshot = createMysqlSchemaSnapshot(schema({ native }))
  expect(snapshot.tables[0]?.columns[0]?.storage).toEqual({
    kind: 'native',
    dialect: 'mysql',
    type: 'DECIMAL(10, 2) UNSIGNED',
  })
  expect(snapshot.tables[0]?.columns[1]?.default).toEqual({
    kind: 'literal',
    value: { kind: 'boolean', value: true },
  })
  expect(
    createSchemaSnapshot(schema({ native }), { adapter: mysqlSnapshotAdapter })
  ).toEqual(snapshot)
  expect(mysqlDialect().name).toBe('mysql')
})

test('round trips MySQL extension data through the strict decoder', () => {
  const snapshot = createMysqlSchemaSnapshot(appSchema)
  const decoded = decodeSchemaSnapshot(encodeSchemaSnapshot(snapshot))

  expect(decoded.ok).toBe(true)
  if (decoded.ok) expect(decoded.value).toEqual(snapshot)
})

test('reports MySQL capability and cross-dialect diagnostics', () => {
  const parent = table('parents', { id: integer() }, row => ({
    constraints: { primary: primaryKey(row.id) },
    indexes: {},
  }))
  const invalid = table(
    'invalid_mysql',
    {
      id: integer(),
      value: text({ nullable: true }),
      changed: timestamp({ onUpdate: currentTimestamp }),
    },
    row => ({
      constraints: {
        parent: foreignKey([row.id], references(parent, parent.id), {
          match: 'full',
          onDelete: 'set-default',
        }),
        valueKey: uniqueConstraint(row.value, { nulls: 'not-distinct' }),
      },
      indexes: {
        partial: index([row.value], { where: gt(row.id, value(0)) }),
      },
    })
  )
  const noKey = table('no_auto_key', {
    id: integer({
      identity: identityColumn('by-default', {
        dialect: { dialect: 'mysql', autoIncrement: true },
      }),
    }),
  })
  const wrongStorage = table('wrong_auto_type', {
    id: text({
      identity: identityColumn('by-default', {
        dialect: { dialect: 'mysql', autoIncrement: true },
      }),
    }),
  })
  const wrongDialect = table('wrong_dialect', {
    value: nativeColumn('postgres', 'TEXT'),
  })
  const result = tryCreateMysqlSchemaSnapshot(
    schema({ parent, invalid, noKey, wrongStorage, wrongDialect })
  )

  expect(result.ok).toBe(false)
  if (!result.ok) {
    expect(
      result.diagnostics.some(
        issue =>
          issue.code === 'unsupported-dialect-option' &&
          issue.path.includes('match')
      )
    ).toBe(true)
    expect(
      result.diagnostics.some(
        issue =>
          issue.code === 'unsupported-dialect-option' &&
          issue.path.includes('predicate')
      )
    ).toBe(true)
    expect(
      result.diagnostics.some(
        issue =>
          issue.code === 'unsupported-dialect-option' &&
          issue.path.includes('nulls')
      )
    ).toBe(true)
    expect(
      result.diagnostics.some(issue => issue.code === 'dialect-mismatch')
    ).toBe(true)
    expect(
      result.diagnostics.some(issue => issue.path.includes('autoIncrement'))
    ).toBe(true)
  }
})

test('rejects raw SQL tagged for another dialect', () => {
  const raw = table('wrong_raw', {
    value: text({
      onUpdate: unsafeSchemaSql('postgres', 'CURRENT_DATE'),
    }),
  })
  const result = tryCreateMysqlSchemaSnapshot(schema({ raw }))

  expect(result.ok).toBe(false)
  if (!result.ok) {
    expect(
      result.diagnostics.some(issue => issue.code === 'dialect-mismatch')
    ).toBe(true)
  }
})

test('rejects MySQL ON UPDATE metadata in other snapshot dialects', () => {
  const updated = table('updated_values', {
    changedAt: timestamp({ onUpdate: currentTimestamp }),
  })
  const registry = schema({ updated })

  const postgres = tryCreatePostgresSchemaSnapshot(registry)
  const sqlite = tryCreateSqliteSchemaSnapshot(registry)

  expect(postgres.ok).toBe(false)
  expect(sqlite.ok).toBe(false)
  if (!postgres.ok)
    expect(
      postgres.diagnostics.some(
        issue =>
          issue.code === 'unsupported-dialect-option' &&
          issue.path.includes('onUpdate')
      )
    ).toBe(true)
  if (!sqlite.ok)
    expect(
      sqlite.diagnostics.some(
        issue =>
          issue.code === 'unsupported-dialect-option' &&
          issue.path.includes('onUpdate')
      )
    ).toBe(true)
})
