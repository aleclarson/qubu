import { expect, test } from 'vitest'
import {
  postgresColumnsQuery,
  postgresConstraintsQuery,
  postgresRelationsQuery,
  postgresServerQuery,
  readPostgresCatalog,
} from '../src/introspection/index.ts'
import type {
  CatalogConnection,
  CatalogQuery,
  IntrospectionOptions,
} from '../src/introspection/index.ts'

type Row = Readonly<Record<string, unknown>>

function connection(
  rows: Readonly<Record<string, readonly Row[]>>,
  dialect: CatalogConnection['dialect'] = 'postgresql'
) {
  const calls: CatalogQuery[] = []
  const value: CatalogConnection = {
    dialect,
    async query<TRow extends Row = Row>(statement: CatalogQuery) {
      calls.push(statement)
      const result = Object.entries(rows).find(([query]) =>
        statement.text.includes(query)
      )?.[1]
      return (result ?? []) as readonly TRow[]
    },
  }
  return { connection: value, calls }
}

function options(namespace = 'tenant'): IntrospectionOptions {
  return { namespace }
}

const completeRows = {
  "current_setting('server_version_num')": [
    { server_version_num: '160002', server_version: '16.0' },
  ],
  'FROM pg_class c': [
    { oid: '10', namespace: 'tenant', relname: 'accounts', relkind: 'r' },
    { oid: '20', namespace: 'tenant', relname: 'owners', relkind: 'r' },
    { oid: '30', namespace: 'tenant', relname: 'account_view', relkind: 'v' },
  ],
  'FROM pg_attribute a': [
    {
      table_oid: '10',
      ordinal_position: 1,
      physical_name: 'id',
      nullable: false,
      native_type: 'integer',
      attidentity: 'a',
      attgenerated: '',
      default_expression: null,
    },
    {
      table_oid: '10',
      ordinal_position: 2,
      physical_name: 'owner_id',
      nullable: true,
      native_type: 'integer',
      attidentity: '',
      attgenerated: '',
      default_expression: '0',
    },
    {
      table_oid: '10',
      ordinal_position: 3,
      physical_name: 'display_name',
      nullable: false,
      native_type: 'text',
      attidentity: '',
      attgenerated: 's',
      default_expression: "lower('ACCOUNTS')",
    },
    {
      table_oid: '20',
      ordinal_position: 1,
      physical_name: 'id',
      nullable: false,
      native_type: 'bigint',
      attidentity: 'd',
      attgenerated: '',
      default_expression: null,
    },
  ],
  'FROM pg_constraint con': [
    {
      oid: '101',
      table_oid: '10',
      physical_name: 'accounts_pkey',
      contype: 'p',
      conkey: [1],
      condeferrable: false,
      condeferred: false,
      convalidated: true,
    },
    {
      oid: '102',
      table_oid: '10',
      physical_name: 'accounts_owner_fk',
      contype: 'f',
      conkey: [2],
      target_table_oid: '20',
      confkey: [1],
      confupdtype: 'c',
      confdeltype: 'n',
      confmatchtype: 's',
      condeferrable: true,
      condeferred: true,
      convalidated: false,
    },
    {
      oid: '103',
      table_oid: '10',
      physical_name: 'accounts_name_check',
      contype: 'c',
      conkey: [],
      definition: "CHECK (display_name <> '')",
      condeferrable: false,
      condeferred: false,
      convalidated: true,
    },
    {
      oid: '104',
      table_oid: '10',
      physical_name: 'accounts_owner_unique',
      contype: 'u',
      conkey: [2],
      indnullsnotdistinct: true,
      condeferrable: false,
      condeferred: false,
      convalidated: true,
    },
  ],
  'FROM pg_index i': [
    {
      index_oid: '201',
      table_oid: '10',
      physical_name: 'accounts_owner_idx',
      indisunique: false,
      indnkeyatts: 1,
      indnatts: 2,
      method: 'btree',
      predicate: 'owner_id IS NOT NULL',
      position: 1,
      attnum: 2,
      indoption: 3,
      term_definition: 'owner_id DESC NULLS FIRST',
    },
    {
      index_oid: '201',
      table_oid: '10',
      physical_name: 'accounts_owner_idx',
      indisunique: false,
      indnkeyatts: 1,
      indnatts: 2,
      method: 'btree',
      predicate: 'owner_id IS NOT NULL',
      position: 2,
      attnum: 1,
      indoption: 0,
      term_definition: 'INCLUDE (id)',
    },
  ],
}

test('normalizes PostgreSQL relations, columns, defaults, generated columns, and identities', async () => {
  const fake = connection(completeRows)
  const catalog = await readPostgresCatalog(fake.connection, options())
  const accounts = catalog.tables[0]!
  const columns = accounts.columns

  expect(catalog.server).toMatchObject({
    product: 'postgresql',
    rawVersion: '16.0',
    parsedVersion: { major: 16 },
    capabilities: { generatedColumns: true, identityMetadata: true },
  })
  expect(accounts.physicalName).toBe('accounts')
  expect(columns).toEqual([
    expect.objectContaining({
      physicalName: 'id',
      identity: { kind: 'identity', generation: 'always', options: {} },
    }),
    expect.objectContaining({
      physicalName: 'owner_id',
      default: expect.objectContaining({ kind: 'expression' }),
    }),
    expect.objectContaining({
      physicalName: 'display_name',
      generated: expect.objectContaining({ mode: 'stored' }),
    }),
  ])
  expect(catalog.deferredObjects).toEqual([
    expect.objectContaining({
      objectKind: 'view',
      physicalName: 'account_view',
    }),
  ])
  expect(
    fake.calls.every(
      call => call.text.includes('$1') || call.parameters.length === 0
    )
  ).toBe(true)
  expect(
    fake.calls.filter(call => call.parameters[0] === 'tenant')
  ).toHaveLength(4)
})

test('normalizes constraints, foreign keys, checks, predicates, terms, and included columns', async () => {
  const { connection: fake } = connection(completeRows)
  const catalog = await readPostgresCatalog(fake, options())
  const accounts = catalog.tables[0]!

  expect(accounts.constraints).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: 'primary-key', columns: ['id'] }),
      expect.objectContaining({
        kind: 'foreign-key',
        columns: ['owner_id'],
        target: { table: 'owners', columns: ['id'] },
        onUpdate: 'cascade',
        onDelete: 'set-null',
        match: 'simple',
        deferrable: true,
        initially: 'deferred',
        validated: false,
      }),
      expect.objectContaining({
        kind: 'check',
        expression: expect.objectContaining({
          text: "CHECK (display_name <> '')",
        }),
      }),
      expect.objectContaining({
        kind: 'unique',
        columns: ['owner_id'],
        nulls: 'not-distinct',
      }),
    ])
  )
  expect(accounts.indexes).toEqual([
    expect.objectContaining({
      physicalName: 'accounts_owner_idx',
      predicate: expect.objectContaining({ text: 'owner_id IS NOT NULL' }),
      includedColumns: ['id'],
      terms: [
        expect.objectContaining({
          kind: 'column',
          column: 'owner_id',
          direction: 'DESC',
          nulls: 'FIRST',
        }),
      ],
    }),
  ])
})

test('gates unsupported PostgreSQL versions', async () => {
  const fake = connection({
    "current_setting('server_version_num')": [
      { server_version_num: '110022', server_version: '11.22' },
    ],
  })
  const catalog = await readPostgresCatalog(fake.connection, options())
  expect(catalog.server.capabilities.generatedColumns).toBe(false)
  expect(catalog.diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: 'unsupported-server',
        severity: 'error',
      }),
    ])
  )
})

test('reports query failures without exposing driver errors', async () => {
  const calls: CatalogQuery[] = []
  const fake: CatalogConnection = {
    dialect: 'postgresql',
    async query<TRow extends Row = Row>(statement: CatalogQuery) {
      calls.push(statement)
      if (statement.text === postgresServerQuery)
        return [
          { server_version_num: '160000', server_version: '16.0' },
        ] as unknown as readonly TRow[]
      if (statement.text === postgresRelationsQuery) return []
      if (statement.text === postgresColumnsQuery) return []
      if (statement.text === postgresConstraintsQuery)
        throw new Error('password=secret')
      return []
    },
  }
  const catalog = await readPostgresCatalog(fake, options('private'))
  expect(catalog.diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: 'query-failed', path: ['constraints'] }),
    ])
  )
  expect(JSON.stringify(catalog.diagnostics)).not.toContain('password')
  expect(
    calls.find(call => call.text === postgresConstraintsQuery)?.parameters
  ).toEqual(['private'])
})

test('rejects a connection from another dialect before querying', async () => {
  const fake = connection({}, 'sqlite')
  const catalog = await readPostgresCatalog(fake.connection, options())
  expect(fake.calls).toHaveLength(0)
  expect(catalog.diagnostics).toEqual([
    expect.objectContaining({ code: 'dialect-mismatch', severity: 'error' }),
  ])
})
