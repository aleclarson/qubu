import { expect, test } from 'vitest'
import {
  eq,
  explain,
  from,
  insertInto,
  integer,
  qubu,
  select,
  table,
  values,
  where,
  type ExplainableQueryAdapter,
  type ExplainRequest,
} from '../src/index.ts'
import { mysqlDialect } from '../src/dialects/mysql.ts'
import { postgresDialect } from '../src/dialects/postgres.ts'
import { sqliteDialect } from '../src/dialects/sqlite.ts'
import { standardDialect } from '../src/dialects/standard.ts'

type PlanRow = { plan: string }

const users = table('users', { id: integer() })
const query = select({ id: users.id }, from(users), where(eq(users.id, 7)))

test('renders PostgreSQL EXPLAIN options and forwards request controls', async () => {
  let received: ExplainRequest | undefined
  let executeCalls = 0
  const adapter: ExplainableQueryAdapter<PlanRow> = {
    dialect: postgresDialect(),
    async execute() {
      executeCalls += 1
      return { rows: [] }
    },
    async explain(request) {
      received = request
      return { rows: [{ plan: 'Index Scan' }] }
    },
  }
  const controller = new AbortController()

  const result = await explain(query, adapter, {
    analyze: true,
    verbose: true,
    buffers: true,
    format: 'json',
    signal: controller.signal,
  })

  expect(received).toEqual({
    statement: {
      text: 'EXPLAIN (ANALYZE, VERBOSE, BUFFERS, FORMAT JSON) SELECT "users"."id" AS "id" FROM "users" WHERE ("users"."id" = $1)',
      parameters: [7],
    },
    queryKind: 'select',
    signal: controller.signal,
  })
  expect(result).toEqual({ rows: [{ plan: 'Index Scan' }] })
  expect(executeCalls).toBe(0)
})

test('renders SQLite and MySQL EXPLAIN modes', async () => {
  const sqliteStatements: string[] = []
  const sqlite: ExplainableQueryAdapter<PlanRow> = {
    dialect: sqliteDialect(),
    async execute() {
      return { rows: [] }
    },
    async explain(request) {
      sqliteStatements.push(request.statement.text)
      return { rows: [] }
    },
  }

  await explain(query, sqlite, { format: 'query-plan' })
  await explain(query, sqlite, { format: 'bytecode' })

  const mysqlStatements: string[] = []
  const mysql: ExplainableQueryAdapter<PlanRow> = {
    dialect: mysqlDialect(),
    async execute() {
      return { rows: [] }
    },
    async explain(request) {
      mysqlStatements.push(request.statement.text)
      return { rows: [] }
    },
  }

  await explain(query, mysql, { format: 'json' })
  await explain(query, mysql, { analyze: true })

  expect(sqliteStatements).toEqual([
    'EXPLAIN QUERY PLAN SELECT "users"."id" AS "id" FROM "users" WHERE ("users"."id" = ?)',
    'EXPLAIN SELECT "users"."id" AS "id" FROM "users" WHERE ("users"."id" = ?)',
  ])
  expect(mysqlStatements).toEqual([
    'EXPLAIN FORMAT=JSON SELECT `users`.`id` AS `id` FROM `users` WHERE (`users`.`id` = ?)',
    'EXPLAIN ANALYZE SELECT `users`.`id` AS `id` FROM `users` WHERE (`users`.`id` = ?)',
  ])
})

test('explains mutations without executing them', async () => {
  let received: ExplainRequest | undefined
  const adapter: ExplainableQueryAdapter<PlanRow> = {
    dialect: sqliteDialect(),
    async execute() {
      throw new Error('execute should not be called by explain')
    },
    async explain(request) {
      received = request
      return { rows: [{ plan: 'SCAN users' }] }
    },
  }
  const mutation = insertInto(users, values({ id: 8 }))

  await explain(mutation, adapter)

  expect(received?.statement.text).toBe(
    'EXPLAIN QUERY PLAN INSERT INTO "users" ("id") VALUES (?)'
  )
  expect(received?.statement.parameters).toEqual([8])
  expect(received?.queryKind).toBe('insert')
})

test('reports unsupported and invalid EXPLAIN options', async () => {
  const sqlite: ExplainableQueryAdapter<PlanRow> = {
    dialect: sqliteDialect(),
    async execute() {
      return { rows: [] }
    },
    async explain() {
      return { rows: [] }
    },
  }
  const postgres: ExplainableQueryAdapter<PlanRow> = {
    dialect: postgresDialect(),
    async execute() {
      return { rows: [] }
    },
    async explain() {
      return { rows: [] }
    },
  }
  const mysql: ExplainableQueryAdapter<PlanRow> = {
    dialect: mysqlDialect(),
    async execute() {
      return { rows: [] }
    },
    async explain() {
      return { rows: [] }
    },
  }
  const mutation = insertInto(users, values({ id: 8 }))

  await expect(explain(query, sqlite, { verbose: true })).rejects.toMatchObject(
    {
      code: 'unsupported-explain-option',
      path: ['verbose'],
    }
  )
  await expect(
    explain(query, postgres, { buffers: true })
  ).rejects.toMatchObject({
    code: 'invalid-explain-options',
    path: ['buffers'],
  })
  await expect(
    Reflect.apply(explain, undefined, [mutation, postgres, { analyze: true }])
  ).rejects.toMatchObject({
    code: 'invalid-explain-query',
    path: ['analyze'],
  })
  await expect(
    explain(query, mysql, { analyze: true, format: 'json' })
  ).rejects.toMatchObject({
    code: 'invalid-explain-options',
    path: ['analyze', 'format'],
  })

  const standard: ExplainableQueryAdapter<PlanRow> = {
    dialect: standardDialect(),
    async execute() {
      return { rows: [] }
    },
    async explain() {
      return { rows: [] }
    },
  }
  await expect(explain(query, standard)).rejects.toMatchObject({
    code: 'unsupported-explain-dialect',
    path: ['dialect'],
  })
})

test('adds explain to a bound explainable client', async () => {
  let received: ExplainRequest | undefined
  const adapter: ExplainableQueryAdapter<PlanRow> = {
    dialect: postgresDialect(),
    async execute() {
      return { rows: [] }
    },
    async explain(request) {
      received = request
      return { rows: [{ plan: 'Seq Scan' }] }
    },
  }

  const result = await qubu(adapter).explain(query)

  expect(result).toEqual({ rows: [{ plan: 'Seq Scan' }] })
  expect(received?.queryKind).toBe('select')
})
