import { DatabaseSync } from 'node:sqlite'
import { bunSqlAdapter } from '../adapters/bun-sql/src/index.ts'
import { d1Adapter } from '../adapters/cloudflare-d1/src/index.ts'
import { mysql2Adapter } from '../adapters/mysql2/src/index.ts'
import { nodeSqliteAdapter } from '../adapters/node-sqlite/src/index.ts'
import { pgAdapter } from '../adapters/pg/src/index.ts'
import { pgliteAdapter } from '../adapters/pglite/src/index.ts'
import { postgresJsAdapter } from '../adapters/postgresjs/src/index.ts'
import { describe, expect, test, vi } from 'vitest'
import type { ExecutionRequest } from '../src/execution.ts'

function request(
  queryKind: ExecutionRequest['queryKind'],
  parameters: readonly unknown[] = [42]
): ExecutionRequest {
  return {
    statement: { text: 'SELECT ?', parameters },
    queryKind,
  }
}

describe('workspace adapters', () => {
  test('node:sqlite executes rows and mutation facts', async () => {
    const database = new DatabaseSync(':memory:')
    database.exec('CREATE TABLE records (id INTEGER PRIMARY KEY, name TEXT)')
    const adapter = nodeSqliteAdapter(database)

    try {
      await expect(
        adapter.execute({
          statement: {
            text: 'INSERT INTO records (name) VALUES (?)',
            parameters: ['Ada'],
          },
          queryKind: 'insert',
        })
      ).resolves.toMatchObject({ affectedRows: 1, insertId: 1 })
      const selected = await adapter.execute<{ name: string }>({
        statement: {
          text: 'SELECT name FROM records WHERE id = ?',
          parameters: [1],
        },
        queryKind: 'select',
      })
      expect(selected).toEqual({ rows: [{ name: 'Ada' }] })
      expect(Object.getPrototypeOf(selected.rows[0])).toBe(Object.prototype)
    } finally {
      database.close()
    }
  })

  test('pg normalizes rows and affected row counts', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 2 })
    const adapter = pgAdapter({ query } as never)

    await expect(adapter.execute(request('select'))).resolves.toEqual({
      rows: [{ id: 1 }],
    })
    await expect(adapter.execute(request('update'))).resolves.toEqual({
      rows: [],
      affectedRows: 2,
    })
  })

  test('mysql2 normalizes result headers', async () => {
    const connection = {
      execute: vi.fn(async () => [
        { affectedRows: 2, changedRows: 1, insertId: 7 },
        [],
      ]),
    }
    const adapter = mysql2Adapter(connection as never)

    await expect(adapter.execute(request('insert'))).resolves.toEqual({
      rows: [],
      affectedRows: 2,
      changedRows: 1,
      insertId: 7,
    })
  })

  test('Bun.SQL normalizes array metadata', async () => {
    const rows = Object.assign([{ id: 1 }], { count: 1 })
    const sql = {
      unsafe: vi.fn(async () => rows),
      begin: vi.fn(),
    }

    await expect(
      bunSqlAdapter(sql as never).execute(request('update'))
    ).resolves.toEqual({ rows: [{ id: 1 }], affectedRows: 1 })
  })

  test('postgres.js normalizes row-list metadata', async () => {
    const rows = Object.assign([{ id: 1 }], { count: 3 })
    const sql = Object.assign(vi.fn(), {
      unsafe: vi.fn(async () => rows),
      begin: vi.fn(),
    })

    await expect(
      postgresJsAdapter(sql as never).execute(request('delete'))
    ).resolves.toEqual({ rows: [{ id: 1 }], affectedRows: 3 })
  })

  test('Cloudflare D1 normalizes mutation metadata', async () => {
    const run = vi.fn(async () => ({
      results: [{ id: 4 }],
      meta: { changes: 1, last_row_id: 4 },
    }))
    const prepared = { bind: vi.fn(() => prepared), run, all: vi.fn() }
    const database = { prepare: vi.fn(() => prepared) }

    await expect(
      d1Adapter(database).execute(request('insert'))
    ).resolves.toEqual({
      rows: [{ id: 4 }],
      affectedRows: 1,
      insertId: 4,
    })
  })

  test('PGlite normalizes PostgreSQL result metadata', async () => {
    const database = {
      query: vi.fn(async () => ({
        rows: [{ id: 1 }],
        rowCount: 2,
        fields: [],
      })),
      transaction: vi.fn(),
    }

    await expect(
      pgliteAdapter(database as never).execute(request('update'))
    ).resolves.toEqual({ rows: [{ id: 1 }], affectedRows: 2 })
  })
})
