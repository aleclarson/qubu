import type { Client, ExecutedQuery, Transaction } from "@planetscale/database"
import {
  booleanResultDecoder,
  dateResultDecoder,
  timestampResultDecoder,
  type DriverValueEncoder,
  type ExecutionRequest,
  type ExecutionResult,
  type ExplainableQueryAdapter,
  type ExplainRequest,
  type ExplainResult,
  type ResultDecoders,
  type TransactionOptions,
  type TransactionalQueryAdapter,
} from "qubu"
import { mysqlDialect } from "qubu/mysql"

/** The promise-based PlanetScale client surface used by this adapter. */
export type PlanetScaleClient = Pick<Client, "execute" | "transaction">
export type PlanetScaleQueryResult<TRow extends object = Record<string, unknown>> =
  ExecutedQuery<TRow>

export interface PlanetScaleAdapterOptions {
  /** Convert Qubu values before PlanetScale formats them. */
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

type PlanetScaleFormatter = (query: string, values: readonly unknown[]) => string
type PlanetScaleClientWithConfig = PlanetScaleClient & {
  readonly config?: {
    readonly format?: PlanetScaleFormatter
  }
}

const planetScaleEncoder: DriverValueEncoder = {
  encode(value) {
    if (
      value === null ||
      typeof value !== "object" ||
      value instanceof Date ||
      value instanceof Uint8Array ||
      Array.isArray(value)
    ) {
      return value
    }

    return JSON.stringify(value)
  },
}

const planetScaleDecoders = {
  boolean: booleanResultDecoder,
  date: dateResultDecoder,
  timestamp: timestampResultDecoder,
} satisfies ResultDecoders

/** Adapt one PlanetScale `Client` or connection for Qubu execution. */
export function planetscaleAdapter(
  client: PlanetScaleClient,
  options: PlanetScaleAdapterOptions = {},
): PlanetScaleAdapter {
  const formatter = configuredFormatter(client)
  const encoder = options.encoder ?? planetScaleEncoder
  const scoped = executionAdapter(client, encoder, formatter)

  return {
    ...scoped,
    client,
    async transaction<T>(
      callback: (adapter: PlanetScaleTransactionAdapter) => Promise<T>,
      transactionOptions: TransactionOptions = {},
    ): Promise<T> {
      throwIfAborted(transactionOptions.signal)
      return client.transaction(async (transaction) => {
        const result = await callback(executionAdapter(transaction, encoder, formatter))

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
  formatter: PlanetScaleFormatter | undefined,
): PlanetScaleTransactionAdapter {
  return {
    dialect: mysqlDialect(),
    decoders: planetScaleDecoders,
    async execute<TRow extends object>(request: ExecutionRequest) {
      throwIfAborted(request.signal)
      const result = await executeStatement<TRow>(executor, request, encoder, formatter)
      const isMutation = request.queryKind !== "select" && request.queryKind !== "set"
      const insertId =
        request.queryKind === "insert" ? normalizeInsertId(result.insertId) : undefined

      return {
        rows: Array.from(result.rows) as readonly TRow[],
        ...(isMutation ? { affectedRows: result.rowsAffected } : {}),
        ...(insertId === undefined ? {} : { insertId }),
      } satisfies ExecutionResult<TRow>
    },
    async explain(request: ExplainRequest) {
      throwIfAborted(request.signal)
      const result = await executeStatement<Record<string, unknown>>(
        executor,
        request,
        encoder,
        formatter,
      )

      return { rows: Array.from(result.rows) } satisfies ExplainResult<Record<string, unknown>>
    },
  }
}

function configuredFormatter(client: PlanetScaleClient): PlanetScaleFormatter | undefined {
  const config = (client as PlanetScaleClientWithConfig).config

  if (config === undefined) {
    return undefined
  }

  const formatter = config.format

  if (typeof formatter !== "function") {
    throw new TypeError(
      "PlanetScale adapter requires a SQL-aware formatter in the PlanetScale client configuration",
    )
  }

  return formatter
}

function executeStatement<TRow extends object>(
  executor: Pick<Client, "execute"> | Transaction,
  request: ExecutionRequest,
  encoder: DriverValueEncoder,
  formatter: PlanetScaleFormatter | undefined,
): Promise<ExecutedQuery<TRow>> {
  const parameters = request.statement.parameters.map((value, index) =>
    encoder.encode(value, request.statement.parameterSqlTypes?.[index]),
  )

  return formatter === undefined
    ? executor.execute<TRow>(request.statement.text, parameters)
    : executor.execute<TRow>(formatter(request.statement.text, parameters))
}

function normalizeInsertId(insertId: string): string | undefined {
  return insertId === "0" ? undefined : insertId
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  signal?.throwIfAborted()
}
