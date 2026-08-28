import {
  createClient,
  type Client,
  type ResultSet,
  type Row,
  type Transaction,
} from '@libsql/client'
import { describe, expect, test, vi } from 'vitest'
import {
  eq,
  execute,
  executeRows,
  from,
  insertInto,
  integer,
  select,
  table,
  text,
  values,
  where,
} from '../src/index.ts'
import { libsqlAdapter } from '../src/libsql.ts'
import type { ExecutionRequest } from '../src/execution.ts'

function result(overrides: Partial<ResultSet> = {}): ResultSet {
  return {
    columns: [],
    columnTypes: [],
    rows: [],
    rowsAffected: 0,
    lastInsertRowid: undefined,
    toJSON() {
      return this
    },
    ...overrides,
  }
}

function request(
  queryKind: ExecutionRequest['queryKind'],
  signal?: AbortSignal
): ExecutionRequest {
  return {
    statement: { text: 'SELECT ?', parameters: [42] },
    queryKind,
    ...(signal === undefined ? {} : { signal }),
  }
}

describe('libsqlAdapter', () => {
  test('executes a bound query through the real local client', async () => {
    const client = createClient({ url: 'file::memory:' })
    const records = table('qubu_libsql_records', {
      id: integer(),
      name: text(),
    })

    try {
      await client.execute(
        'CREATE TABLE qubu_libsql_records (id INTEGER PRIMARY KEY, name TEXT NOT NULL)'
      )
      const adapter = libsqlAdapter(client)
      const inserted = await execute(
        insertInto(records, values({ id: 1, name: 'Ada' })),
        adapter
      )
      const rows = await executeRows(
        select(
          { id: records.id, name: records.name },
          from(records),
          where(eq(records.id, 1))
        ),
        adapter
      )

      expect(inserted).toMatchObject({ affectedRows: 1, insertId: 1n })
      expect(rows).toEqual([{ id: 1, name: 'Ada' }])
    } finally {
      client.close()
    }
  })

  test('binds positional values and normalizes mutation facts', async () => {
    const rows = [{ id: 7 }] as unknown as Row[]
    const execute = vi.fn(async () =>
      result({ rows, rowsAffected: 1, lastInsertRowid: 7n })
    )
    const client = { execute } as unknown as Client
    const adapter = libsqlAdapter(client, {
      encoder: { encode: value => String(value) },
    })

    await expect(
      adapter.execute<{ id: number }>(request('insert'))
    ).resolves.toEqual({
      rows,
      affectedRows: 1,
      insertId: 7n,
    })
    expect(execute).toHaveBeenCalledWith({ sql: 'SELECT ?', args: ['42'] })
  })

  test('omits unspecified mutation facts from read results', async () => {
    const rows = [{ id: 7 }] as unknown as Row[]
    const client = {
      execute: vi.fn(async () => result({ rows, rowsAffected: 0 })),
    } as unknown as Client

    await expect(
      libsqlAdapter(client).execute(request('select'))
    ).resolves.toEqual({
      rows,
    })
  })

  test('commits callback transactions with a scoped adapter', async () => {
    const transactionExecute = vi.fn(async () => result())
    const transaction = {
      execute: transactionExecute,
      commit: vi.fn(async () => undefined),
      rollback: vi.fn(async () => undefined),
      close: vi.fn(),
      closed: false,
    } as unknown as Transaction
    const begin = vi.fn(async () => transaction)
    const client = { transaction: begin } as unknown as Client
    const adapter = libsqlAdapter(client, { transactionMode: 'read' })

    await expect(
      adapter.transaction(async scoped => {
        await scoped.execute(request('select'))
        return 'committed'
      })
    ).resolves.toBe('committed')

    expect(begin).toHaveBeenCalledWith('read')
    expect(transaction.commit).toHaveBeenCalledOnce()
    expect(transaction.rollback).not.toHaveBeenCalled()
    expect(transaction.close).toHaveBeenCalledOnce()
  })

  test('rolls back a failed callback and closes the transaction', async () => {
    const transaction = {
      commit: vi.fn(async () => undefined),
      rollback: vi.fn(async function (this: { closed: boolean }) {
        this.closed = true
      }),
      close: vi.fn(),
      closed: false,
    } as unknown as Transaction
    const client = {
      transaction: vi.fn(async () => transaction),
    } as unknown as Client
    const failure = new Error('callback failed')

    await expect(
      libsqlAdapter(client).transaction(async () => {
        throw failure
      })
    ).rejects.toBe(failure)
    expect(transaction.rollback).toHaveBeenCalledOnce()
    expect(transaction.close).toHaveBeenCalledOnce()
  })

  test('does not start work for an already aborted request', async () => {
    const execute = vi.fn(async () => result())
    const client = { execute } as unknown as Client
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))

    await expect(
      libsqlAdapter(client).execute(request('select', controller.signal))
    ).rejects.toThrow('cancelled')
    expect(execute).not.toHaveBeenCalled()
  })
})
