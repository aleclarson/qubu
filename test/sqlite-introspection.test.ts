import { expect, test } from 'vitest'
import {
  readSqliteCatalog,
  sqliteForeignKeyQuery,
  sqliteIndexInfoQuery,
  sqliteIndexListQuery,
  sqliteServerQuery,
  sqliteTableInfoQuery,
  sqliteTableListQuery,
} from '../src/introspection/index.ts'
import type {
  CatalogConnection,
  CatalogQuery,
  IntrospectionOptions,
} from '../src/introspection/index.ts'

type Row = Readonly<Record<string, unknown>>

function options(namespace = 'main'): IntrospectionOptions {
  return { namespace }
}

function connection(
  rows: (statement: CatalogQuery) => readonly Row[],
  dialect: CatalogConnection['dialect'] = 'sqlite'
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
    if (statement.text === sqliteServerQuery)
      return [{ version: '3.45.1', source_id: '2024-test-build' }]
    if (statement.text.includes('FROM main.sqlite_schema'))
      return [
        {
          type: 'table',
          name: 'child',
          tbl_name: 'child',
          sql: 'CREATE TABLE child (parent_a INTEGER, parent_b INTEGER, doubled INTEGER GENERATED ALWAYS AS (parent_a + parent_b) STORED, hidden_col TEXT HIDDEN, PRIMARY KEY (parent_a, parent_b), FOREIGN KEY (parent_a, parent_b) REFERENCES parent(a, b) ON UPDATE CASCADE ON DELETE SET NULL) WITHOUT ROWID, STRICT',
        },
        {
          type: 'table',
          name: 'parent',
          tbl_name: 'parent',
          sql: 'CREATE TABLE parent (id INTEGER PRIMARY KEY AUTOINCREMENT, a TEXT, b TEXT, UNIQUE (a, b))',
        },
        {
          type: 'index',
          name: 'child_live_idx',
          tbl_name: 'child',
          sql: 'CREATE INDEX child_live_idx ON child(parent_b DESC) WHERE parent_b > 0',
        },
        {
          type: 'view',
          name: 'child_view',
          tbl_name: 'child_view',
          sql: 'CREATE VIEW child_view AS SELECT * FROM child',
        },
        {
          type: 'trigger',
          name: 'child_trigger',
          tbl_name: 'child',
          sql: 'CREATE TRIGGER child_trigger AFTER INSERT ON child BEGIN SELECT 1; END',
        },
      ]
    if (statement.text === sqliteTableListQuery)
      return [
        { schema: 'main', name: 'child', type: 'table', wr: 1, strict: 1 },
        { schema: 'main', name: 'parent', type: 'table', wr: 0, strict: 0 },
      ]
    if (
      statement.text === sqliteTableInfoQuery &&
      statement.parameters[0] === 'parent'
    )
      return [
        {
          cid: 0,
          name: 'id',
          type: 'INTEGER',
          not_null: 0,
          dflt_value: null,
          pk: 1,
          hidden: 0,
        },
        {
          cid: 1,
          name: 'a',
          type: 'TEXT',
          not_null: 0,
          dflt_value: "'a'",
          pk: 0,
          hidden: 0,
        },
        {
          cid: 2,
          name: 'b',
          type: 'TEXT',
          not_null: 0,
          dflt_value: null,
          pk: 0,
          hidden: 0,
        },
      ]
    if (statement.text === sqliteTableInfoQuery)
      return [
        {
          cid: 0,
          name: 'parent_a',
          type: 'INTEGER',
          not_null: 1,
          dflt_value: null,
          pk: 1,
          hidden: 0,
        },
        {
          cid: 1,
          name: 'parent_b',
          type: 'INTEGER',
          not_null: 1,
          dflt_value: null,
          pk: 2,
          hidden: 0,
        },
        {
          cid: 2,
          name: 'doubled',
          type: 'INTEGER',
          not_null: 0,
          dflt_value: null,
          pk: 0,
          hidden: 3,
        },
        {
          cid: 3,
          name: 'hidden_col',
          type: 'TEXT',
          not_null: 0,
          dflt_value: null,
          pk: 0,
          hidden: 1,
        },
      ]
    if (
      statement.text === sqliteIndexListQuery &&
      statement.parameters[0] === 'child'
    )
      return [
        {
          seq: 0,
          name: 'child_live_idx',
          unique_index: 0,
          origin: 'c',
          partial: 1,
        },
        {
          seq: 1,
          name: 'sqlite_autoindex_child_1',
          unique_index: 1,
          origin: 'u',
          partial: 0,
        },
      ]
    if (statement.text === sqliteIndexInfoQuery)
      return [
        {
          seqno: 0,
          cid: 1,
          name: 'parent_b',
          descending: 1,
          coll: 'BINARY',
          key: 1,
        },
      ]
    if (statement.text === sqliteForeignKeyQuery)
      return [
        {
          id: 0,
          seq: 1,
          target_table: 'parent',
          source_column: 'parent_b',
          target_column: 'b',
          on_update: 'CASCADE',
          on_delete: 'SET NULL',
          match: 'NONE',
        },
        {
          id: 0,
          seq: 0,
          target_table: 'parent',
          source_column: 'parent_a',
          target_column: 'a',
          on_update: 'CASCADE',
          on_delete: 'SET NULL',
          match: 'NONE',
        },
      ]
    return []
  })
}

test('normalizes SQLite versions, capabilities, table features, columns, and deferred objects', async () => {
  const fake = completeConnection()
  const catalog = await readSqliteCatalog(fake.connection, options())
  const child = catalog.tables.find(table => table.physicalName === 'child')!
  const parent = catalog.tables.find(table => table.physicalName === 'parent')!

  expect(catalog.server).toMatchObject({
    product: 'sqlite',
    rawVersion: '3.45.1',
    parsedVersion: { major: 3, minor: 45, patch: 1 },
    capabilities: {
      generatedColumns: true,
      indexPredicates: true,
      sourceIdAvailable: true,
    },
  })
  expect(child.unknownFields).toEqual(
    expect.arrayContaining([
      { name: 'withoutRowid', value: true },
      { name: 'strict', value: true },
    ])
  )
  expect(child.columns.map(column => column.physicalName)).toEqual([
    'parent_a',
    'parent_b',
    'doubled',
  ])
  expect(child.columns[2]).toMatchObject({
    generated: { mode: 'stored', expression: { text: 'parent_a + parent_b' } },
  })
  expect(
    child.columns.some(column => column.physicalName === 'hidden_col')
  ).toBe(false)
  expect(parent.columns[0]).toMatchObject({
    identity: {
      generation: 'by-default',
      dialect: { data: { autoIncrement: true } },
    },
  })
  expect(child.columns.every(column => !column.identity)).toBe(true)
  expect(catalog.deferredObjects).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        objectKind: 'view',
        physicalName: 'child_view',
      }),
      expect.objectContaining({
        objectKind: 'trigger',
        physicalName: 'child_trigger',
      }),
    ])
  )
})

test('normalizes primary keys, user indexes, partial predicates, and grouped foreign keys', async () => {
  const catalog = await readSqliteCatalog(
    completeConnection().connection,
    options()
  )
  const child = catalog.tables.find(table => table.physicalName === 'child')!

  expect(child.constraints).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: 'primary-key',
        columns: ['parent_a', 'parent_b'],
      }),
      expect.objectContaining({
        kind: 'foreign-key',
        columns: ['parent_a', 'parent_b'],
        target: { table: 'parent', columns: ['a', 'b'] },
        onUpdate: 'cascade',
        onDelete: 'set-null',
        match: 'simple',
      }),
    ])
  )
  expect(
    child.constraints.some(constraint =>
      constraint.physicalName?.startsWith('sqlite_autoindex_')
    )
  ).toBe(false)
  expect(child.indexes).toEqual([
    expect.objectContaining({
      physicalName: 'child_live_idx',
      terms: [
        { kind: 'column', column: 'parent_b', position: 0, direction: 'DESC' },
      ],
      predicate: expect.objectContaining({ text: 'parent_b > 0' }),
    }),
  ])
})

test('reports unsupported versions, dialect mismatches, and query diagnostics', async () => {
  const old = connection(statement =>
    statement.text === sqliteServerQuery ? [{ version: '3.36.0' }] : []
  )
  const oldCatalog = await readSqliteCatalog(old.connection, options())
  expect(oldCatalog.diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: 'unsupported-server',
        severity: 'error',
      }),
    ])
  )

  const mismatch = connection(() => [], 'postgresql')
  const mismatchCatalog = await readSqliteCatalog(
    mismatch.connection,
    options()
  )
  expect(mismatch.calls).toHaveLength(0)
  expect(mismatchCatalog.diagnostics).toEqual([
    expect.objectContaining({ code: 'dialect-mismatch', severity: 'error' }),
  ])

  const failing = connection(statement => {
    if (statement.text === sqliteServerQuery) return [{ version: '3.45.0' }]
    if (statement.text === sqliteTableListQuery)
      throw new Error('password=secret')
    return []
  })
  const failingCatalog = await readSqliteCatalog(
    failing.connection,
    options('private')
  )
  expect(failingCatalog.diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: 'query-failed', path: ['table-list'] }),
    ])
  )
  expect(JSON.stringify(failingCatalog.diagnostics)).not.toContain('secret')
})
