import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import type {
  DriverValueEncoder,
  ExecutionRequest,
  ExecutionResult,
  ExplainableQueryAdapter,
  ExplainRequest,
  ExplainResult,
  TransactionOptions,
  TransactionalQueryAdapter,
} from 'qubu'
import { mysqlDialect } from 'qubu/mysql'

export interface Mysql2AdapterOptions {
  readonly encoder?: DriverValueEncoder
}

export interface Mysql2Connection {
  execute(
    text: string,
    parameters?: any[]
  ): Promise<
    [RowDataPacket[] | RowDataPacket[][] | ResultSetHeader, readonly unknown[]]
  >
  beginTransaction(): Promise<void>
  commit(): Promise<void>
  rollback(): Promise<void>
}

export interface Mysql2TransactionAdapter
  extends ExplainableQueryAdapter<RowDataPacket> {}

export interface Mysql2Adapter
  extends ExplainableQueryAdapter<RowDataPacket>,
    TransactionalQueryAdapter<Mysql2TransactionAdapter> {
  readonly connection: Mysql2Connection
}

const identityEncoder: DriverValueEncoder = { encode: value => value }

/** Adapt one application-owned `mysql2/promise` connection. */
export function mysql2Adapter(
  connection: Mysql2Connection,
  options: Mysql2AdapterOptions = {}
): Mysql2Adapter {
  const scoped = executionAdapter(
    connection,
    options.encoder ?? identityEncoder
  )
  return {
    ...scoped,
    connection,
    async transaction<T>(
      callback: (adapter: Mysql2TransactionAdapter) => Promise<T>,
      transactionOptions: TransactionOptions = {}
    ): Promise<T> {
      throwIfAborted(transactionOptions.signal)
      await connection.beginTransaction()
      try {
        const result = await callback(scoped)
        throwIfAborted(transactionOptions.signal)
        await connection.commit()
        return result
      } catch (error) {
        await connection.rollback()
        throw error
      }
    },
  }
}

function executionAdapter(
  connection: Mysql2Connection,
  encoder: DriverValueEncoder
): Mysql2TransactionAdapter {
  return {
    dialect: mysqlDialect(),
    async execute<TRow extends object>(request: ExecutionRequest) {
      throwIfAborted(request.signal)
      const [result] = await connection.execute(
        request.statement.text,
        request.statement.parameters.map(value => encoder.encode(value))
      )
      if (Array.isArray(result)) {
        return { rows: result as unknown as readonly TRow[] }
      }
      const header = result as ResultSetHeader
      return {
        rows: [],
        affectedRows: header.affectedRows,
        changedRows: header.changedRows,
        ...(request.queryKind === 'insert'
          ? { insertId: header.insertId }
          : {}),
      } satisfies ExecutionResult<TRow>
    },
    async explain(request: ExplainRequest) {
      throwIfAborted(request.signal)
      const [result] = await connection.execute(
        request.statement.text,
        request.statement.parameters.map(value => encoder.encode(value))
      )
      return {
        rows: (Array.isArray(result) ? result : []) as readonly RowDataPacket[],
      } satisfies ExplainResult<RowDataPacket>
    },
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  signal?.throwIfAborted()
}
