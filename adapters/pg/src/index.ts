import type { ClientBase, Pool, QueryResultRow } from "pg"
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

export interface PgAdapter<TClient extends ClientBase | Pool = ClientBase | Pool>
  extends ExplainableQueryAdapter<QueryResultRow>, TransactionalQueryAdapter<PgTransactionAdapter> {
  readonly client: TClient
}

const identityEncoder: DriverValueEncoder = { encode: (value) => value }

/**
 * Adapt an application-owned `pg` pool or connected client. Queries and EXPLAIN use the supplied
 * connection. Pooled transactions acquire and release one client; failed BEGIN or rollback cleanup
 * discards that client. The adapter never closes the pool or releases a directly supplied client.
 */
export function pgAdapter<TClient extends ClientBase | Pool>(
  client: TClient,
  options: PgAdapterOptions = {},
): PgAdapter<TClient> {
  const encoder = options.encoder ?? identityEncoder
  const scoped = executionAdapter(client, encoder)

  return {
    ...scoped,
    client,
    async transaction<T>(
      callback: (adapter: PgTransactionAdapter) => Promise<T>,
      transactionOptions: TransactionOptions = {},
    ): Promise<T> {
      throwIfAborted(transactionOptions.signal)
      // Pool and Client both expose connect(); pool counts distinguish ownership.
      const acquired = "totalCount" in client ? await client.connect() : undefined
      const connection = acquired ?? client
      let discard = false
      let failed = false
      let failure: unknown
      let result!: T

      try {
        throwIfAborted(transactionOptions.signal)
        try {
          await connection.query("BEGIN")
        } catch (error) {
          // A rejected BEGIN may leave the connection state uncertain.
          discard = true
          throw error
        }

        try {
          result = await callback(executionAdapter(connection, encoder))

          throwIfAborted(transactionOptions.signal)
          await connection.query("COMMIT")
        } catch (error) {
          try {
            await connection.query("ROLLBACK")
          } catch (rollbackError) {
            discard = true
            throw new AggregateError(
              [error, rollbackError],
              "Transaction failed and rollback failed",
              { cause: error },
            )
          }

          throw error
        }
      } catch (error) {
        failed = true
        failure = error
      }

      try {
        acquired?.release(discard)
      } catch (releaseError) {
        if (failed) {
          throw new AggregateError(
            [failure, releaseError],
            "Transaction failed and client release failed",
            { cause: failure },
          )
        }

        throw releaseError
      }

      if (failed) {
        throw failure
      }

      return result
    },
  }
}

function executionAdapter(
  client: ClientBase | Pool,
  encoder: DriverValueEncoder,
): PgTransactionAdapter {
  return {
    dialect: postgresDialect(),
    async execute<TRow extends object>(request: ExecutionRequest) {
      throwIfAborted(request.signal)
      const result = await client.query(
        request.statement.text,
        request.statement.parameters.map((value, index) =>
          encoder.encode(value, request.statement.parameterSqlTypes?.[index]),
        ),
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
        request.statement.parameters.map((value, index) =>
          encoder.encode(value, request.statement.parameterSqlTypes?.[index]),
        ),
      )

      return { rows: result.rows } satisfies ExplainResult<QueryResultRow>
    },
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  signal?.throwIfAborted()
}
