import { DatabaseSync } from 'node:sqlite'
import { Client } from 'pg'
import mysql from 'mysql2/promise'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import {
  eq,
  execute,
  executeRows,
  fetchFirst,
  from,
  insertInto,
  integer,
  json,
  jsonPath,
  jsonText,
  orderBy,
  primaryKey,
  returning,
  select,
  table,
  text,
  update,
  values,
  where,
} from '../../src/index.ts'
import { mysqlDialect } from '../../src/dialects/mysql.ts'
import {
  doUpdate,
  excluded,
  onConflict,
  postgresDialect,
} from '../../src/dialects/postgres.ts'
import { sqliteDialect } from '../../src/dialects/sqlite.ts'
import type {
  ExecutionRequest,
  ExecutionResult,
  QueryAdapter,
} from '../../src/index.ts'
import type {
  CatalogConnection,
  CatalogDialect,
  CatalogQuery,
  CatalogQueryRow,
} from '../../src/introspection/index.ts'
import {
  readMysqlCatalog,
  readPostgresCatalog,
  readSqliteCatalog,
} from '../../src/introspection/index.ts'

const liveDialects = ['postgresql', 'sqlite', 'mysql'] as const
type LiveDialect = (typeof liveDialects)[number]

const configuredDialect = process.env.QUBU_E2E_DIALECT

function isLiveDialect(value: string): value is LiveDialect {
  return (liveDialects as readonly string[]).includes(value)
}

if (configuredDialect !== undefined && !isLiveDialect(configuredDialect)) {
  throw new Error(`QUBU_E2E_DIALECT must be one of ${liveDialects.join(', ')}`)
}

const selectedDialect = configuredDialect as LiveDialect | undefined

const records = table(
  'qubu_e2e_records',
  {
    id: integer(),
    name: text(),
    payload: json<unknown>(),
  },
  records => ({
    constraints: { primary: primaryKey(records.id) },
    indexes: {},
  })
)

interface E2eDriver {
  execute<TRow extends object = Record<string, unknown>>(
    request: ExecutionRequest
  ): Promise<ExecutionResult<TRow>>
  exec(text: string): Promise<void>
  close(): Promise<void>
}

interface E2eEnvironment {
  readonly driver: E2eDriver
  readonly adapter: QueryAdapter
  readonly catalog: CatalogConnection
  readonly catalogDialect: CatalogDialect
  readonly namespace: string
}

const schemaSql: Record<LiveDialect, readonly string[]> = {
  postgresql: [
    `
    CREATE TABLE qubu_e2e_records (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      payload JSONB NOT NULL,
      CONSTRAINT qubu_e2e_records_name_check CHECK (char_length(name) > 0)
    )
  `,
    'CREATE INDEX qubu_e2e_records_name_idx ON qubu_e2e_records (name)',
  ],
  sqlite: [
    `
    CREATE TABLE qubu_e2e_records (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      payload TEXT NOT NULL,
      CONSTRAINT qubu_e2e_records_name_check CHECK (length(name) > 0)
    )
  `,
    'CREATE INDEX qubu_e2e_records_name_idx ON qubu_e2e_records (name)',
  ],
  mysql: [
    `
    CREATE TABLE qubu_e2e_records (
      id INTEGER PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      payload JSON NOT NULL,
      CONSTRAINT qubu_e2e_records_name_check CHECK (CHAR_LENGTH(name) > 0)
    )
  `,
    'CREATE INDEX qubu_e2e_records_name_idx ON qubu_e2e_records (name)',
  ],
}

const dropSql = 'DROP TABLE IF EXISTS qubu_e2e_records'

async function createDriver(dialect: LiveDialect): Promise<E2eDriver> {
  if (dialect === 'postgresql') {
    const client = new Client({
      connectionString:
        process.env.POSTGRES_URL ??
        'postgresql://postgres:postgres@127.0.0.1:5432/qubu',
    })
    await client.connect()
    return {
      async execute<TRow extends object>(request: ExecutionRequest) {
        request.signal?.throwIfAborted()
        const result = await client.query(request.statement.text, [
          ...request.statement.parameters,
        ])
        return {
          rows: result.rows as unknown as readonly TRow[],
          ...(isMutation(request) && result.rowCount !== null
            ? { affectedRows: result.rowCount }
            : {}),
        }
      },
      async exec(text: string) {
        await client.query(text)
      },
      async close() {
        await client.end()
      },
    }
  }

  if (dialect === 'mysql') {
    const connection = await mysql.createConnection({
      host: process.env.MYSQL_HOST ?? '127.0.0.1',
      port: Number(process.env.MYSQL_PORT ?? 3306),
      user: process.env.MYSQL_USER ?? 'root',
      password: process.env.MYSQL_PASSWORD ?? 'root',
      database: process.env.MYSQL_DATABASE ?? 'qubu',
    })
    return {
      async execute<TRow extends object>(request: ExecutionRequest) {
        request.signal?.throwIfAborted()
        const [result] = await connection.query(request.statement.text, [
          ...request.statement.parameters,
        ])
        if (Array.isArray(result)) {
          return { rows: result as unknown as readonly TRow[] }
        }
        return {
          rows: [] as readonly TRow[],
          affectedRows: result.affectedRows,
          changedRows: result.changedRows,
          ...(request.queryKind === 'insert' && result.insertId !== 0
            ? { insertId: result.insertId }
            : {}),
        }
      },
      async exec(text: string) {
        await connection.query(text)
      },
      async close() {
        await connection.end()
      },
    }
  }

  const database = new DatabaseSync(':memory:')
  return {
    async execute<TRow extends object>(request: ExecutionRequest) {
      request.signal?.throwIfAborted()
      const statement = database.prepare(request.statement.text)
      const bindParameters = request.statement.parameters as unknown as Array<
        string | number | bigint | Uint8Array | null
      >
      if (!isMutation(request) || statement.columns().length > 0) {
        const rows = statement.all(
          ...bindParameters
        ) as unknown as readonly TRow[]
        return {
          rows,
          ...(isMutation(request) ? { affectedRows: rows.length } : {}),
        }
      }
      const result = statement.run(...bindParameters)
      return {
        rows: [] as readonly TRow[],
        affectedRows: result.changes,
        ...(request.queryKind === 'insert'
          ? { insertId: result.lastInsertRowid }
          : {}),
      }
    },
    async exec(text: string) {
      database.exec(text)
    },
    async close() {
      database.close()
    },
  }
}

async function createEnvironment(
  dialectName: LiveDialect
): Promise<E2eEnvironment> {
  const dialect =
    dialectName === 'postgresql'
      ? postgresDialect()
      : dialectName === 'mysql'
        ? mysqlDialect()
        : sqliteDialect()
  const driver = await createDriver(dialectName)
  const adapter: QueryAdapter = {
    dialect,
    execute<TRow extends object>(request: ExecutionRequest) {
      return driver.execute<TRow>(request)
    },
  }
  const catalog: CatalogConnection = {
    dialect: dialectName,
    async query<TRow extends CatalogQueryRow = CatalogQueryRow>(
      statement: CatalogQuery
    ) {
      const result = await driver.execute<TRow>({
        statement,
        queryKind: 'select',
      })
      return result.rows
    },
  }

  return {
    driver,
    adapter,
    catalog,
    catalogDialect: dialectName,
    namespace:
      dialectName === 'postgresql'
        ? 'public'
        : dialectName === 'mysql'
          ? 'qubu'
          : 'main',
  }
}

function isMutation(request: ExecutionRequest) {
  return (
    request.queryKind === 'insert' ||
    request.queryKind === 'update' ||
    request.queryKind === 'delete'
  )
}

async function readCatalog(environment: E2eEnvironment) {
  if (environment.catalogDialect === 'postgresql') {
    return readPostgresCatalog(environment.catalog, {
      namespace: environment.namespace,
    })
  }
  if (environment.catalogDialect === 'mysql') {
    return readMysqlCatalog(environment.catalog, {
      namespace: environment.namespace,
    })
  }
  return readSqliteCatalog(environment.catalog, {
    namespace: environment.namespace,
  })
}

function seedAda(environment: E2eEnvironment) {
  return execute(
    insertInto(
      records,
      values({
        id: 1,
        name: 'Ada',
        payload: JSON.stringify({ user: { name: 'Ada' } }),
      })
    ),
    environment.adapter
  )
}

describe.skipIf(!selectedDialect)('live dialect E2E', () => {
  const dialectName = selectedDialect as LiveDialect
  let environment: E2eEnvironment | undefined

  beforeAll(async () => {
    environment = await createEnvironment(dialectName)
    await environment.driver.exec(dropSql)
    for (const statement of schemaSql[dialectName]) {
      await environment.driver.exec(statement)
    }
  }, 30_000)

  beforeEach(async () => {
    if (!environment) throw new Error('E2E environment was not initialized')
    await environment.driver.exec('DELETE FROM qubu_e2e_records')
  }, 30_000)

  afterAll(async () => {
    if (!environment) return
    await environment.driver.exec(dropSql)
    await environment.driver.close()
  }, 30_000)

  test('executes parameterized queries through the dialect adapter', async () => {
    if (!environment) throw new Error('E2E environment was not initialized')

    await seedAda(environment)

    const query = select(
      {
        id: records.id,
        name: records.name,
        payloadName: jsonText(records.payload, jsonPath('user', 'name')),
      },
      from(records),
      where(eq(records.id, 1)),
      orderBy(records.id),
      fetchFirst(1)
    )

    await expect(executeRows(query, environment.adapter)).resolves.toEqual([
      { id: 1, name: 'Ada', payloadName: 'Ada' },
    ])
  }, 30_000)

  test('executes mutations and observes their results', async () => {
    if (!environment) throw new Error('E2E environment was not initialized')

    const insertion = await seedAda(environment)
    const mutation = await execute(
      update(records, { name: 'Grace' }, where(eq(records.id, 1))),
      environment.adapter
    )

    const query = select(
      { name: records.name },
      from(records),
      where(eq(records.id, 1))
    )

    expect(mutation.affectedRows).toBe(1)
    if (dialectName === 'sqlite') expect(insertion.insertId).toBe(1)
    if (dialectName === 'mysql') expect(mutation.changedRows).toBe(1)
    await expect(executeRows(query, environment.adapter)).resolves.toEqual([
      { name: 'Grace' },
    ])
  }, 30_000)

  test.skipIf(dialectName === 'mysql')(
    'executes a conflicting insert as an update',
    async () => {
      if (!environment) throw new Error('E2E environment was not initialized')

      await seedAda(environment)

      const incoming = excluded(records)
      const rows = await executeRows(
        insertInto(
          records,
          values({
            id: 1,
            name: 'Grace',
            payload: JSON.stringify({ user: { name: 'Grace' } }),
          }),
          onConflict(
            records,
            records.constraints.primary,
            doUpdate(
              { name: incoming.name },
              where(eq(incoming.id, records.id))
            )
          ),
          returning({ name: records.name })
        ),
        environment.adapter
      )

      expect(rows).toEqual([{ name: 'Grace' }])
    },
    30_000
  )

  test('reads the selected namespace through its catalog adapter', async () => {
    if (!environment) throw new Error('E2E environment was not initialized')

    const catalog = await readCatalog(environment)
    const table = catalog.tables.find(
      current => current.physicalName === 'qubu_e2e_records'
    )

    expect(catalog.dialect).toBe(dialectName)
    expect(
      catalog.diagnostics.filter(issue => issue.severity === 'error')
    ).toEqual([])
    expect(table).toBeDefined()
    expect(table?.columns.map(column => column.physicalName)).toEqual(
      expect.arrayContaining(['id', 'name', 'payload'])
    )
  }, 30_000)
})
