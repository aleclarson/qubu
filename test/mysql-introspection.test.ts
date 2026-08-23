import { expect, test } from 'vitest'
import {
  mapCatalogToCompleteSnapshot,
  mysqlChecksQuery,
  mysqlColumnsQuery,
  mysqlCollationsQuery,
  mysqlEventsQuery,
  mysqlKeyUsageQuery,
  mysqlPartitionsQuery,
  mysqlRoutineParametersQuery,
  mysqlRoutinesQuery,
  mysqlServerQuery,
  mysqlStatisticsQuery,
  mysqlTablesQuery,
  mysqlTriggersQuery,
  mysqlViewsQuery,
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
        {
          table_name: 'orders',
          table_type: 'BASE TABLE',
          engine: 'InnoDB',
          table_collation: 'utf8mb4_0900_ai_ci',
          create_options: 'partitioned',
          table_comment: 'Order records',
        },
        {
          table_name: 'customers',
          table_type: 'BASE TABLE',
          engine: 'InnoDB',
          table_collation: 'utf8mb4_0900_ai_ci',
          create_options: '',
          table_comment: '',
        },
        {
          table_name: 'order_view',
          table_type: 'VIEW',
          table_collation: 'utf8mb4_0900_ai_ci',
          table_comment: 'Order summary',
        },
        { table_name: 'legacy_sequence', table_type: 'SEQUENCE' },
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
          character_set_name: null,
          collation_name: null,
          column_comment: 'Primary order identifier',
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
          character_set_name: null,
          collation_name: null,
          column_comment: '',
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
          character_set_name: 'utf8mb4',
          collation_name: 'utf8mb4_0900_ai_ci',
          column_comment: 'Customer-facing label',
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
          character_set_name: null,
          collation_name: null,
          column_comment: '',
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
          character_set_name: null,
          collation_name: null,
          column_comment: '',
        },
        {
          table_name: 'orders',
          column_name: 'customer_id',
          ordinal_position: 6,
          column_type: 'bigint unsigned',
          data_type: 'bigint',
          is_nullable: 'YES',
          column_default: null,
          extra: '',
          generation_expression: null,
          character_set_name: null,
          collation_name: null,
          column_comment: '',
        },
        {
          table_name: 'customers',
          column_name: 'id',
          ordinal_position: 1,
          column_type: 'bigint unsigned',
          data_type: 'bigint',
          is_nullable: 'NO',
          column_default: null,
          extra: '',
          generation_expression: null,
          character_set_name: null,
          collation_name: null,
          column_comment: '',
        },
        {
          table_name: 'order_view',
          column_name: 'view_id',
          ordinal_position: 1,
          column_type: 'bigint unsigned',
          data_type: 'bigint',
          is_nullable: 'NO',
          column_default: null,
          extra: '',
          generation_expression: null,
          character_set_name: null,
          collation_name: null,
          column_comment: 'Projected order identifier',
        },
        {
          table_name: 'order_view',
          column_name: 'label',
          ordinal_position: 2,
          column_type: 'varchar(100)',
          data_type: 'varchar',
          is_nullable: 'YES',
          column_default: null,
          extra: '',
          generation_expression: null,
          character_set_name: 'utf8mb4',
          collation_name: 'utf8mb4_0900_ai_ci',
          column_comment: '',
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
          is_visible: 'YES',
          comment: 'label lookup',
          index_comment: 'prefix index',
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
          is_visible: 'NO',
          comment: '',
          index_comment: '',
        },
      ]
    if (statement.text === mysqlViewsQuery)
      return [
        {
          table_name: 'order_view',
          view_definition: 'SELECT id AS view_id, label FROM orders',
          check_option: 'CASCADED',
          is_updatable: 'YES',
          security_type: 'INVOKER',
          definer: 'app@localhost',
        },
      ]
    if (statement.text === mysqlRoutinesQuery)
      return [
        {
          routine_name: 'calculate_total',
          routine_type: 'FUNCTION',
          data_type: 'decimal',
          dtd_identifier: 'decimal(10,2)',
          routine_body: 'SQL',
          routine_definition: 'RETURN amount + tax',
          external_language: null,
          sql_data_access: 'CONTAINS SQL',
          is_deterministic: 'YES',
          security_type: 'INVOKER',
          sql_mode: 'STRICT_TRANS_TABLES',
          routine_comment: 'Calculates an order total',
        },
        {
          routine_name: 'archive_orders',
          routine_type: 'PROCEDURE',
          data_type: null,
          dtd_identifier: null,
          routine_body: 'SQL',
          routine_definition: 'INSERT INTO order_archive SELECT * FROM orders',
          external_language: null,
          sql_data_access: 'MODIFIES SQL DATA',
          is_deterministic: 'NO',
          security_type: 'DEFINER',
          sql_mode: 'STRICT_TRANS_TABLES',
          routine_comment: '',
        },
      ]
    if (statement.text === mysqlRoutineParametersQuery)
      return [
        {
          routine_name: 'calculate_total',
          ordinal_position: 0,
          parameter_mode: null,
          parameter_name: null,
          data_type: 'decimal',
          dtd_identifier: 'decimal(10,2)',
        },
        {
          routine_name: 'calculate_total',
          ordinal_position: 1,
          parameter_mode: 'IN',
          parameter_name: 'amount',
          data_type: 'decimal',
          dtd_identifier: 'decimal(10,2)',
        },
        {
          routine_name: 'calculate_total',
          ordinal_position: 2,
          parameter_mode: 'IN',
          parameter_name: 'tax',
          data_type: 'decimal',
          dtd_identifier: 'decimal(10,2)',
        },
        {
          routine_name: 'archive_orders',
          ordinal_position: 1,
          parameter_mode: 'INOUT',
          parameter_name: 'order_id',
          data_type: 'bigint',
          dtd_identifier: 'bigint',
        },
      ]
    if (statement.text === mysqlTriggersQuery)
      return [
        {
          trigger_name: 'orders_audit',
          event_manipulation: 'INSERT',
          table_name: 'orders',
          action_condition: 'NEW.total >= 0',
          action_statement: 'INSERT INTO order_audit VALUES (NEW.id)',
          action_orientation: 'ROW',
          action_timing: 'BEFORE',
          action_order: 1,
          definer: 'app@localhost',
          sql_mode: 'STRICT_TRANS_TABLES',
        },
        {
          trigger_name: 'orders_audit',
          event_manipulation: 'UPDATE',
          table_name: 'orders',
          action_condition: 'NEW.total >= 0',
          action_statement: 'INSERT INTO order_audit VALUES (NEW.id)',
          action_orientation: 'ROW',
          action_timing: 'BEFORE',
          action_order: 2,
          definer: 'app@localhost',
          sql_mode: 'STRICT_TRANS_TABLES',
        },
      ]
    if (statement.text === mysqlPartitionsQuery)
      return [
        {
          table_name: 'orders',
          partition_name: 'p2024',
          subpartition_name: null,
          partition_ordinal_position: 1,
          subpartition_ordinal_position: null,
          partition_method: 'RANGE',
          subpartition_method: null,
          partition_expression: 'id',
          subpartition_expression: null,
          partition_description: '2025',
          partition_comment: 'Current orders',
          tablespace_name: 'innodb_file_per_table',
        },
      ]
    if (statement.text === mysqlCollationsQuery)
      return [
        {
          collation_name: 'utf8mb4_0900_ai_ci',
          character_set_name: 'utf8mb4',
          collation_id: 255,
          is_default: 'Yes',
          is_compiled: 'Yes',
          sort_length: 1,
          pad_attribute: 'NO PAD',
        },
      ]
    if (statement.text === mysqlEventsQuery)
      return [
        {
          event_name: 'refresh_orders',
          event_type: 'RECURRING',
          status: 'ENABLED',
          event_definition: 'CALL archive_orders()',
          event_body: 'SQL',
          execute_at: null,
          interval_value: '1',
          interval_field: 'DAY',
          event_comment: 'Refresh order metrics',
          definer: 'app@localhost',
        },
      ]
    return []
  })
}

test('reads MySQL version gates, native columns, defaults, generated columns, and table metadata', async () => {
  const fake = completeConnection()
  const catalog = await readMysqlCatalog(fake.connection, options())
  const orders = catalog.tables[0]!
  const columns = orders.columns

  expect(catalog.server).toMatchObject({
    product: 'mysql',
    parsedVersion: { major: 8, minor: 0, patch: 36 },
    capabilities: {
      generatedColumns: true,
      checkConstraints: true,
      views: true,
      routines: true,
      triggers: true,
      partitions: true,
      collations: true,
      scheduledEvents: true,
    },
  })
  expect(columns).toHaveLength(6)
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
  expect(orders).toMatchObject({
    dialect: {
      dialect: 'mysql',
      version: 1,
      data: {
        engine: 'InnoDB',
        collation: 'utf8mb4_0900_ai_ci',
        createOptions: 'partitioned',
      },
    },
  })
  expect(catalog.views).toEqual([
    expect.objectContaining({
      kind: 'view',
      physicalName: 'order_view',
      definition: expect.objectContaining({
        text: 'SELECT id AS view_id, label FROM orders',
      }),
      columns: [
        expect.objectContaining({ physicalName: 'view_id' }),
        expect.objectContaining({ physicalName: 'label' }),
      ],
      checkOption: 'cascaded',
      securityInvoker: true,
    }),
  ])
  expect(catalog.deferredObjects).toEqual([
    expect.objectContaining({
      objectKind: 'other',
      physicalName: 'legacy_sequence',
    }),
  ])
  expect(fake.calls.filter(call => call.parameters[0] === 'shop')).toHaveLength(
    12
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

test('normalizes complete MySQL object families, retains boundaries, and maps Snapshot v2', async () => {
  const fake = completeConnection()
  const catalog = await readMysqlCatalog(fake.connection, options())

  expect(catalog.views).toEqual([
    expect.objectContaining({ physicalName: 'order_view' }),
  ])
  expect(catalog.routines).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        physicalName: 'calculate_total',
        routineKind: 'function',
        returnType: { nativeType: 'decimal(10,2)' },
        parameters: [
          expect.objectContaining({
            name: 'amount',
            mode: 'in',
          }),
          expect.objectContaining({
            name: 'tax',
            mode: 'in',
          }),
        ],
        body: expect.objectContaining({ text: 'RETURN amount + tax' }),
        security: 'invoker',
        dialect: expect.objectContaining({
          data: expect.objectContaining({ deterministic: true }),
        }),
      }),
      expect.objectContaining({
        physicalName: 'archive_orders',
        routineKind: 'procedure',
        parameters: [expect.objectContaining({ mode: 'inout' })],
        security: 'definer',
      }),
    ])
  )
  expect(catalog.triggers).toEqual([
    expect.objectContaining({
      physicalName: 'orders_audit',
      table: { kind: 'table', id: 'orders' },
      timing: 'before',
      events: ['insert', 'update'],
      orientation: 'row',
      condition: expect.objectContaining({ text: 'NEW.total >= 0' }),
      body: expect.objectContaining({
        text: 'INSERT INTO order_audit VALUES (NEW.id)',
      }),
    }),
  ])
  expect(catalog.partitions).toEqual([
    expect.objectContaining({
      physicalName: 'p2024',
      parent: { kind: 'table', id: 'orders' },
      strategy: 'range',
      keyColumns: ['id'],
      bound: expect.objectContaining({ text: '2025' }),
      comment: expect.objectContaining({ text: 'Current orders' }),
    }),
  ])
  expect(catalog.collations).toEqual([
    expect.objectContaining({
      physicalName: 'utf8mb4_0900_ai_ci',
      dialect: expect.objectContaining({
        data: expect.objectContaining({
          characterSet: 'utf8mb4',
          id: 255,
          isDefault: true,
          padAttribute: 'NO PAD',
        }),
      }),
    }),
  ])
  expect(catalog.opaqueObjects).toEqual([
    expect.objectContaining({
      objectKind: 'event',
      physicalName: 'refresh_orders',
      data: expect.objectContaining({
        eventType: 'RECURRING',
        status: 'ENABLED',
        intervalValue: '1',
        intervalField: 'DAY',
        definer: 'app@localhost',
      }),
      sql: expect.objectContaining({ text: 'CALL archive_orders()' }),
    }),
  ])
  expect(catalog.deferredObjects).toEqual([
    expect.objectContaining({
      objectKind: 'other',
      physicalName: 'legacy_sequence',
    }),
  ])
  expect(catalog.comments).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ text: 'Order records' }),
      expect.objectContaining({ text: 'Primary order identifier' }),
      expect.objectContaining({ text: 'Order summary' }),
      expect.objectContaining({ text: 'Calculates an order total' }),
      expect.objectContaining({ text: 'Current orders' }),
      expect.objectContaining({ text: 'Refresh order metrics' }),
      expect.objectContaining({
        object: { kind: 'column', id: 'view_id' },
        text: 'Projected order identifier',
      }),
    ])
  )
  expect(catalog.namespace.dialect).toEqual(
    expect.objectContaining({
      dialect: 'mysql',
      version: 1,
      data: expect.objectContaining({
        selectedNamespace: 'shop',
        views: true,
        routines: true,
        triggers: true,
        partitions: true,
        collations: true,
      }),
    })
  )
  expect(catalog.diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: 'unmodeled-object',
        path: ['deferredObjects', 'legacy_sequence'],
      }),
      expect.objectContaining({
        code: 'unmodeled-object',
        path: ['opaqueObjects', 'refresh_orders'],
      }),
    ])
  )

  const queryTexts = new Set(fake.calls.map(call => call.text))
  expect(queryTexts).toEqual(
    new Set([
      mysqlServerQuery,
      mysqlTablesQuery,
      mysqlViewsQuery,
      mysqlColumnsQuery,
      mysqlKeyUsageQuery,
      mysqlChecksQuery,
      mysqlStatisticsQuery,
      mysqlRoutinesQuery,
      mysqlRoutineParametersQuery,
      mysqlTriggersQuery,
      mysqlPartitionsQuery,
      mysqlCollationsQuery,
      mysqlEventsQuery,
    ])
  )
  expect(
    fake.calls.find(call => call.text === mysqlCollationsQuery)?.parameters
  ).toEqual(['shop', 'shop'])

  const mapped = mapCatalogToCompleteSnapshot(catalog)
  expect(mapped.ok).toBe(true)
  if (!mapped.ok) return
  expect(mapped.snapshot.version).toBe(2)
  expect(mapped.snapshot.tables).toHaveLength(2)
  expect(mapped.snapshot.views).toHaveLength(1)
  expect(mapped.snapshot.collations).toHaveLength(1)
  expect(mapped.snapshot.routines).toHaveLength(2)
  expect(mapped.snapshot.triggers).toHaveLength(1)
  expect(mapped.snapshot.partitions).toHaveLength(1)
  expect(mapped.snapshot.deferredObjects).toEqual([
    expect.objectContaining({
      objectKind: 'other',
      physicalName: 'legacy_sequence',
    }),
  ])
  expect(mapped.snapshot.opaqueObjects).toEqual([
    expect.objectContaining({
      objectKind: 'event',
      physicalName: 'refresh_orders',
    }),
  ])
  expect(mapped.snapshot.comments.length).toBeGreaterThanOrEqual(6)
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
