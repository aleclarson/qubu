import type { ClientBase, QueryResultRow } from "pg"
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

export interface PgAdapterOptions {
  readonly encoder?: DriverValueEncoder
}

export interface PgTransactionAdapter extends ExplainableQueryAdapter<QueryResultRow> {}

export interface PgAdapter
  extends ExplainableQueryAdapter<QueryResultRow>, TransactionalQueryAdapter<PgTransactionAdapter> {
  readonly client: ClientBase
}

const identityEncoder: DriverValueEncoder = { encode: (value) => value }

/** Adapt one pinned `pg` client. Pools must acquire a client before adapting. */
export function pgAdapter(client: ClientBase, options: PgAdapterOptions = {}): PgAdapter {
  const scoped = executionAdapter(client, options.encoder ?? identityEncoder)

  return {
    ...scoped,
    client,
    async transaction<T>(
      callback: (adapter: PgTransactionAdapter) => Promise<T>,
      transactionOptions: TransactionOptions = {},
    ): Promise<T> {
      throwIfAborted(transactionOptions.signal)
      await client.query("BEGIN")
      try {
        const result = await callback(scoped)

        throwIfAborted(transactionOptions.signal)
        await client.query("COMMIT")
        return result
      } catch (error) {
        await client.query("ROLLBACK")
        throw error
      }
    },
  }
}

function executionAdapter(client: ClientBase, encoder: DriverValueEncoder): PgTransactionAdapter {
  return {
    dialect: postgresDialect(),
    async execute<TRow extends object>(request: ExecutionRequest) {
      throwIfAborted(request.signal)
      const result = await client.query(
        request.statement.text,
        request.statement.parameters.map((value) => encoder.encode(value)),
      )
      const isMutation = request.queryKind !== "select" && request.queryKind !== "set"

      return {
        rows: result.rows as readonly TRow[],
        ...(isMutation && result.rowCount !== null ? { affectedRows: result.rowCount } : {}),
      } satisfies ExecutionResult<TRow>
    },
    async explain(request: ExplainRequest) {
      throwIfAborted(request.signal)
      const result = await client.query(
        request.statement.text,
        request.statement.parameters.map((value) => encoder.encode(value)),
      )

      return { rows: result.rows } satisfies ExplainResult<QueryResultRow>
    },
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  signal?.throwIfAborted()
}
