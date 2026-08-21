import { expect, test } from 'vitest'
import {
  mysqlChecksQuery,
  mysqlColumnsQuery,
  mysqlKeyUsageQuery,
  mysqlServerQuery,
  mysqlStatisticsQuery,
  mysqlTablesQuery,
  readMysqlCatalog,
} from '../src/introspection/index.ts'
import type {
  CatalogConnection,
  CatalogQuery,
  IntrospectionOptions,
} from '../src/introspection/index.ts'

type Row = Readonly<Record<string, unknown>>

function options(namespace = 'shop'): IntrospectionOptions {
  return { namespace }
}

function connection(
  rows: (statement: CatalogQuery) => readonly Row[],
  dialect: CatalogConnection['dialect'] = 'mysql'
) {
  const calls: CatalogQuery[] = []
  const value: CatalogConnection = {
    dialect,
    async query<TRow extends Row = Row>(statement: CatalogQuery) {
      calls.push(statement)
      return rows(statement) as readonly TRow[]
    },
  }
  return { connection: value, calls }
}

function completeConnection() {
  return connection(statement => {
    if (statement.text === mysqlServerQuery)
      return [{ version: '8.0.36', version_comment: 'MySQL Community Server' }]
    if (statement.text === mysqlTablesQuery)
      return [
        { table_name: 'orders', table_type: 'BASE TABLE' },
        { table_name: 'order_view', table_type: 'VIEW' },
      ]
    if (statement.text === mysqlColumnsQuery)
      return [
        {
          table_name: 'orders',
          column_name: 'id',
          ordinal_position: 1,
          column_type: 'bigint unsigned',
          data_type: 'bigint',
          is_nullable: 'NO',
          column_default: null,
          extra: 'auto_increment',
          generation_expression: null,
        },
        {
          table_name: 'orders',
          column_name: 'active',
          ordinal_position: 2,
          column_type: 'tinyint(1)',
          data_type: 'tinyint',
          is_nullable: 'NO',
          column_default: '0',
          extra: '',
          generation_expression: null,
        },
        {
          table_name: 'orders',
          column_name: 'label',
          ordinal_position: 3,
          column_type: 'varchar(100)',
          data_type: 'varchar',
          is_nullable: 'YES',
          column_default: '',
          extra: '',
          generation_expression: null,
        },
        {
          table_name: 'orders',
          column_name: 'total',
          ordinal_position: 4,
          column_type: 'decimal(10,2)',
          data_type: 'decimal',
          is_nullable: 'NO',
          column_default: 'CURRENT_TIMESTAMP',
          extra: 'on update CURRENT_TIMESTAMP',
          generation_expression: null,
        },
        {
          table_name: 'orders',
          column_name: 'computed',
          ordinal_position: 5,
          column_type: 'decimal(10,2)',
          data_type: 'decimal',
          is_nullable: 'YES',
          column_default: null,
          extra: 'STORED GENERATED',
          generation_expression: 'subtotal + tax',
        },
      ]
    if (statement.text === mysqlKeyUsageQuery)
      return [
        {
          table_name: 'orders',
          constraint_name: 'PRIMARY',
          constraint_type: 'PRIMARY KEY',
          enforced: 'YES',
          column_name: 'id',
          ordinal_position: 1,
        },
        {
          table_name: 'orders',
          constraint_name: 'orders_customer_fk',
          constraint_type: 'FOREIGN KEY',
          enforced: 'YES',
          column_name: 'customer_id',
          ordinal_position: 1,
          referenced_table_name: 'customers',
          referenced_column_name: 'id',
          update_rule: 'CASCADE',
          delete_rule: 'SET NULL',
          match_option: 'NONE',
        },
        {
          table_name: 'orders',
          constraint_name: 'orders_label_unique',
          constraint_type: 'UNIQUE',
          enforced: 'YES',
          column_name: 'label',
          ordinal_position: 1,
        },
      ]
    if (statement.text === mysqlChecksQuery)
      return [
        {
          table_name: 'orders',
          constraint_name: 'orders_total_check',
          enforced: 'YES',
          check_clause: '`total` >= 0',
        },
      ]
    if (statement.text === mysqlStatisticsQuery)
      return [
        {
          table_name: 'orders',
          index_name: 'orders_label_idx',
          non_unique: 0,
          seq_in_index: 1,
          column_name: 'label',
          collation: 'D',
          index_type: 'BTREE',
          expression: null,
          sub_part: 12,
        },
        {
          table_name: 'orders',
          index_name: 'orders_total_idx',
          non_unique: 1,
          seq_in_index: 1,
          column_name: null,
          collation: null,
          index_type: 'BTREE',
          expression: '(total + 1)',
          sub_part: null,
        },
      ]
    return []
  })
}

test('reads MySQL version gates, native columns, defaults, generated columns, and deferred views', async () => {
  const fake = completeConnection()
  const catalog = await readMysqlCatalog(fake.connection, options())
  const orders = catalog.tables[0]!
  const columns = orders.columns

  expect(catalog.server).toMatchObject({
    product: 'mysql',
    parsedVersion: { major: 8, minor: 0, patch: 36 },
    capabilities: { generatedColumns: true, checkConstraints: true },
  })
  expect(columns).toHaveLength(5)
  expect(columns[0]).toMatchObject({
    physicalName: 'id',
    storage: { nativeType: 'bigint unsigned' },
    identity: { dialect: { data: { autoIncrement: true } } },
  })
  expect(columns[1]).toMatchObject({
    physicalName: 'active',
    default: { kind: 'literal', value: 0 },
  })
  expect(columns[2]).toMatchObject({
    physicalName: 'label',
    default: { kind: 'literal', value: '' },
  })
  expect(columns[3]).toMatchObject({
    physicalName: 'total',
    default: { kind: 'expression', expression: { text: 'CURRENT_TIMESTAMP' } },
    onUpdate: { text: 'CURRENT_TIMESTAMP' },
  })
  expect(columns[4]).toMatchObject({
    physicalName: 'computed',
    generated: { mode: 'stored', expression: { text: 'subtotal + tax' } },
  })
  expect(catalog.deferredObjects).toEqual([
    expect.objectContaining({ objectKind: 'view', physicalName: 'order_view' }),
  ])
  expect(fake.calls.filter(call => call.parameters[0] === 'shop')).toHaveLength(
    5
  )
})

test('reads constraints, referential actions, STATISTICS terms, and prefix diagnostics', async () => {
  const catalog = await readMysqlCatalog(
    completeConnection().connection,
    options()
  )
  const orders = catalog.tables[0]!

  expect(orders.constraints).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: 'primary-key', columns: ['id'] }),
      expect.objectContaining({
        kind: 'unique',
        columns: ['label'],
        nulls: 'distinct',
      }),
      expect.objectContaining({
        kind: 'foreign-key',
        onUpdate: 'cascade',
        onDelete: 'set-null',
        match: 'simple',
      }),
      expect.objectContaining({
        kind: 'check',
        expression: expect.objectContaining({ text: '`total` >= 0' }),
      }),
    ])
  )
  expect(orders.indexes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        physicalName: 'orders_label_idx',
        unique: true,
        terms: [
          expect.objectContaining({
            column: 'label',
            direction: 'DESC',
            prefixLength: { kind: 'literal', value: 12 },
          }),
        ],
      }),
      expect.objectContaining({
        physicalName: 'orders_total_idx',
        terms: [
          expect.objectContaining({
            kind: 'expression',
            expression: expect.objectContaining({ text: '(total + 1)' }),
          }),
        ],
      }),
    ])
  )
  expect(catalog.diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: 'lossy-mapping', severity: 'warning' }),
    ])
  )
})

test('rejects MariaDB and unsupported MySQL versions', async () => {
  const maria = connection(statement =>
    statement.text === mysqlServerQuery
      ? [{ version: '10.11.6-MariaDB', version_comment: 'MariaDB Server' }]
      : []
  )
  const mariaCatalog = await readMysqlCatalog(maria.connection, options())
  expect(mariaCatalog.server.product).toBe('mariadb')
  expect(mariaCatalog.diagnostics).toEqual([
    expect.objectContaining({ code: 'unsupported-product' }),
  ])

  const old = connection(statement =>
    statement.text === mysqlServerQuery
      ? [{ version: '8.0.15', version_comment: 'MySQL Community Server' }]
      : []
  )
  const oldCatalog = await readMysqlCatalog(old.connection, options())
  expect(oldCatalog.diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: 'unsupported-server' }),
    ])
  )
  expect(oldCatalog.server.capabilities.checkConstraints).toBe(false)
})

test('reports query diagnostics without leaking driver errors and preserves parameters', async () => {
  const calls: CatalogQuery[] = []
  const fake: CatalogConnection = {
    dialect: 'mysql',
    async query<TRow extends Row = Row>(statement: CatalogQuery) {
      calls.push(statement)
      if (statement.text === mysqlServerQuery)
        return [
          { version: '8.0.36', version_comment: 'MySQL' },
        ] as unknown as readonly TRow[]
      if (statement.text === mysqlTablesQuery)
        throw new Error('password=secret')
      return [] as readonly TRow[]
    },
  }
  const catalog = await readMysqlCatalog(fake, options('private'))
  expect(catalog.diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: 'query-failed', path: ['tables'] }),
    ])
  )
  expect(JSON.stringify(catalog.diagnostics)).not.toContain('secret')
  expect(
    calls.find(call => call.text === mysqlTablesQuery)?.parameters
  ).toEqual(['private'])
})

test('rejects a connection from another dialect before querying', async () => {
  const fake = connection(() => [], 'sqlite')
  const catalog = await readMysqlCatalog(fake.connection, options())
  expect(fake.calls).toHaveLength(0)
  expect(catalog.diagnostics).toEqual([
    expect.objectContaining({ code: 'dialect-mismatch', severity: 'error' }),
  ])
})
