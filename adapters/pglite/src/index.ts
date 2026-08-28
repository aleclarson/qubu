import type {
  PGliteInterface,
  Results,
  Row,
  Transaction,
} from '@electric-sql/pglite'
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
import { postgresDialect } from 'qubu/postgres'

export interface PgliteAdapterOptions {
  readonly encoder?: DriverValueEncoder
}

export interface PgliteTransactionAdapter
  extends ExplainableQueryAdapter<Row> {}

export interface PgliteAdapter
  extends ExplainableQueryAdapter<Row>,
    TransactionalQueryAdapter<PgliteTransactionAdapter> {
  readonly database: PGliteInterface
}

interface PgliteExecutor {
  query<TRow>(text: string, parameters?: any[]): Promise<Results<TRow>>
}

const identityEncoder: DriverValueEncoder = { encode: value => value }

/** Adapt one application-owned PGlite database. */
export function pgliteAdapter(
  database: PGliteInterface,
  options: PgliteAdapterOptions = {}
): PgliteAdapter {
  const encoder = options.encoder ?? identityEncoder
  const scoped = executionAdapter(database, encoder)
  return {
    ...scoped,
    database,
    transaction(callback, transactionOptions: TransactionOptions = {}) {
      throwIfAborted(transactionOptions.signal)
      return database.transaction(async transaction => {
        const result = await callback(executionAdapter(transaction, encoder))
        throwIfAborted(transactionOptions.signal)
        return result
      })
    },
  }
}

function executionAdapter(
  database: PgliteExecutor | Transaction,
  encoder: DriverValueEncoder
): PgliteTransactionAdapter {
  return {
    dialect: postgresDialect(),
    async execute<TRow extends object>(request: ExecutionRequest) {
      throwIfAborted(request.signal)
      const result = await database.query<TRow>(
        request.statement.text,
        request.statement.parameters.map(value => encoder.encode(value))
      )
      const isMutation =
        request.queryKind !== 'select' && request.queryKind !== 'set'
      const affectedRows = result.rowCount ?? result.affectedRows
      return {
        rows: result.rows,
        ...(isMutation && affectedRows !== undefined ? { affectedRows } : {}),
      } satisfies ExecutionResult<TRow>
    },
    async explain(request: ExplainRequest) {
      throwIfAborted(request.signal)
      const result = await database.query<Row>(
        request.statement.text,
        request.statement.parameters.map(value => encoder.encode(value))
      )
      return { rows: result.rows } satisfies ExplainResult<Row>
    },
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  signal?.throwIfAborted()
}
