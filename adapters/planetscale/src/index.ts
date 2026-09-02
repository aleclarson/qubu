import type { Client, ExecutedQuery, Transaction } from "@planetscale/database"
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
import { mysqlDialect } from "qubu/mysql"

/** The promise-based PlanetScale client surface used by this adapter. */
export type PlanetScaleClient = Pick<Client, "execute" | "transaction">
export type PlanetScaleQueryResult<TRow extends object = Record<string, unknown>> =
  ExecutedQuery<TRow>

export interface PlanetScaleAdapterOptions {
  /** Convert Qubu values before the PlanetScale client formats them. */
  readonly encoder?: DriverValueEncoder
}

export interface PlanetScaleTransactionAdapter extends ExplainableQueryAdapter<
  Record<string, unknown>
> {}

export interface PlanetScaleAdapter
  extends
    ExplainableQueryAdapter<Record<string, unknown>>,
    TransactionalQueryAdapter<PlanetScaleTransactionAdapter> {
  readonly client: PlanetScaleClient
}

const identityEncoder: DriverValueEncoder = { encode: (value) => value }

/** Adapt one PlanetScale `Client` or connection for Qubu execution. */
export function planetscaleAdapter(
  client: PlanetScaleClient,
  options: PlanetScaleAdapterOptions = {},
): PlanetScaleAdapter {
  const encoder = options.encoder ?? identityEncoder
  const scoped = executionAdapter(client, encoder)

  return {
    ...scoped,
    client,
    async transaction<T>(
      callback: (adapter: PlanetScaleTransactionAdapter) => Promise<T>,
      transactionOptions: TransactionOptions = {},
    ): Promise<T> {
      throwIfAborted(transactionOptions.signal)
      return client.transaction(async (transaction) => {
        const result = await callback(executionAdapter(transaction, encoder))

        throwIfAborted(transactionOptions.signal)
        return result
      })
    },
  }
}

/** Camel-case alias for applications that spell the provider name as two words. */
export const planetScaleAdapter = planetscaleAdapter

function executionAdapter(
  executor: Pick<Client, "execute"> | Transaction,
  encoder: DriverValueEncoder,
): PlanetScaleTransactionAdapter {
  return {
    dialect: mysqlDialect(),
    async execute<TRow extends object>(request: ExecutionRequest) {
      throwIfAborted(request.signal)
      const result = await executor.execute<TRow>(
        request.statement.text,
        request.statement.parameters.map((value, index) =>
          encoder.encode(value, request.statement.parameterSqlTypes?.[index]),
        ),
      )
      const isMutation = request.queryKind !== "select" && request.queryKind !== "set"

      return {
        rows: Array.from(result.rows) as readonly TRow[],
        ...(isMutation ? { affectedRows: result.rowsAffected } : {}),
        ...(request.queryKind === "insert" ? { insertId: result.insertId } : {}),
      } satisfies ExecutionResult<TRow>
    },
    async explain(request: ExplainRequest) {
      throwIfAborted(request.signal)
      const result = await executor.execute<Record<string, unknown>>(
        request.statement.text,
        request.statement.parameters.map((value, index) =>
          encoder.encode(value, request.statement.parameterSqlTypes?.[index]),
        ),
      )

      return { rows: Array.from(result.rows) } satisfies ExplainResult<Record<string, unknown>>
    },
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  signal?.throwIfAborted()
}
