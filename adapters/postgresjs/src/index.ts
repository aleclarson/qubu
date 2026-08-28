import type { Row, Sql, TransactionSql } from "postgres"
import type {
  DriverValueEncoder,
  ExecutionRequest,
  ExecutionResult,
  ExplainableQueryAdapter,
  ExplainRequest,
  ExplainResult,
  TransactionOptions,
  TransactionalQueryAdapter,
} from "qubu"
import { postgresDialect } from "qubu/postgres"

export interface PostgresJsAdapterOptions {
  readonly beginOptions?: string
  readonly encoder?: DriverValueEncoder
}

export interface PostgresJsTransactionAdapter extends ExplainableQueryAdapter<Row> {}

export interface PostgresJsAdapter
  extends ExplainableQueryAdapter<Row>, TransactionalQueryAdapter<PostgresJsTransactionAdapter> {
  readonly sql: Sql
  readonly beginOptions?: string
}

const identityEncoder: DriverValueEncoder = { encode: (value) => value }

/** Adapt one application-owned postgres.js `Sql` client. */
export function postgresJsAdapter(
  sql: Sql,
  options: PostgresJsAdapterOptions = {},
): PostgresJsAdapter {
  const encoder = options.encoder ?? identityEncoder
  const scoped = executionAdapter(sql, encoder)

  return {
    ...scoped,
    sql,
    ...(options.beginOptions === undefined ? {} : { beginOptions: options.beginOptions }),
    async transaction<T>(
      callback: (adapter: PostgresJsTransactionAdapter) => Promise<T>,
      transactionOptions: TransactionOptions = {},
    ): Promise<T> {
      throwIfAborted(transactionOptions.signal)
      const run = async (transaction: TransactionSql) => {
        const result = await callback(executionAdapter(transaction, encoder))

        throwIfAborted(transactionOptions.signal)
        return result
      }

      return (await (options.beginOptions === undefined
        ? sql.begin(run)
        : sql.begin(options.beginOptions, run))) as T
    },
  }
}

function executionAdapter(
  sql: Sql | TransactionSql,
  encoder: DriverValueEncoder,
): PostgresJsTransactionAdapter {
  return {
    dialect: postgresDialect(),
    async execute<TRow extends object>(request: ExecutionRequest) {
      throwIfAborted(request.signal)
      const result = await sql.unsafe<Row[]>(
        request.statement.text,
        request.statement.parameters.map((value) => encoder.encode(value)) as never[],
      )
      const isMutation = request.queryKind !== "select" && request.queryKind !== "set"

      return {
        rows: Array.from(result) as unknown as readonly TRow[],
        ...(isMutation ? { affectedRows: result.count } : {}),
      } satisfies ExecutionResult<TRow>
    },
    async explain(request: ExplainRequest) {
      throwIfAborted(request.signal)
      const result = await sql.unsafe<Row[]>(
        request.statement.text,
        request.statement.parameters.map((value) => encoder.encode(value)) as never[],
      )

      return { rows: Array.from(result) } satisfies ExplainResult<Row>
    },
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  signal?.throwIfAborted()
}
