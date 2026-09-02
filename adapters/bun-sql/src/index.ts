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
import type { Dialect } from "qubu/core"

export interface BunSqlResult<TRow extends object = Record<string, unknown>> extends Array<TRow> {
  readonly count?: number | null
  readonly affectedRows?: number | bigint | null
  readonly lastInsertRowid?: number | bigint | null
}

export interface BunSqlQuery<TRows extends object[]> extends PromiseLike<TRows> {
  /** Cancel an in-flight query; Bun's SQLite backend may already be synchronous at this point. */
  cancel(): void
}

export interface BunSqlExecutor {
  unsafe<TRows extends object[]>(text: string, parameters?: readonly unknown[]): BunSqlQuery<TRows>
}

export interface BunSqlClient extends BunSqlExecutor {
  begin<T>(callback: (transaction: BunSqlExecutor) => Promise<T>): Promise<T>
}

export interface BunSqlAdapterOptions {
  /** Match the dialect configured for the Bun SQL client. Bun SQL supports multiple backends. */
  readonly dialect: Dialect
  readonly encoder?: DriverValueEncoder
}

export interface BunSqlTransactionAdapter extends ExplainableQueryAdapter<
  Record<string, unknown>
> {}

export interface BunSqlAdapter
  extends
    ExplainableQueryAdapter<Record<string, unknown>>,
    TransactionalQueryAdapter<BunSqlTransactionAdapter> {
  readonly sql: BunSqlClient
}

const identityEncoder: DriverValueEncoder = { encode: (value) => value }

/** Adapt one application-owned `Bun.SQL` client with an explicit backend dialect. */
export function bunSqlAdapter(sql: BunSqlClient, options: BunSqlAdapterOptions): BunSqlAdapter {
  if (options?.dialect === undefined) {
    throw new TypeError("bunSqlAdapter requires an explicit dialect")
  }

  const { dialect } = options
  const encoder = options.encoder ?? identityEncoder
  const scoped = executionAdapter(sql, dialect, encoder)

  return {
    ...scoped,
    sql,
    transaction(callback, transactionOptions: TransactionOptions = {}) {
      throwIfAborted(transactionOptions.signal)
      return sql.begin(async (transaction) => {
        const result = await callback(executionAdapter(transaction, dialect, encoder))

        throwIfAborted(transactionOptions.signal)
        return result
      })
    },
  }
}

function executionAdapter(
  sql: BunSqlExecutor,
  dialect: Dialect,
  encoder: DriverValueEncoder,
): BunSqlTransactionAdapter {
  return {
    dialect,
    async execute<TRow extends object>(request: ExecutionRequest) {
      const result = (await executeQuery<TRow[]>(
        sql,
        request.statement.text,
        request.statement.parameters.map((value, index) =>
          encoder.encode(value, request.statement.parameterSqlTypes?.[index]),
        ),
        request.signal,
      )) as BunSqlResult<TRow>
      const isMutation = request.queryKind !== "select" && request.queryKind !== "set"
      const affectedRows = result.count ?? result.affectedRows
      const insertId = request.queryKind === "insert" ? result.lastInsertRowid : undefined

      return {
        rows: Array.from(result),
        ...(isMutation && affectedRows !== undefined && affectedRows !== null
          ? { affectedRows }
          : {}),
        ...(insertId !== undefined && insertId !== null ? { insertId } : {}),
      } satisfies ExecutionResult<TRow>
    },
    async explain(request: ExplainRequest) {
      const result = await executeQuery<Record<string, unknown>[]>(
        sql,
        request.statement.text,
        request.statement.parameters.map((value, index) =>
          encoder.encode(value, request.statement.parameterSqlTypes?.[index]),
        ),
        request.signal,
      )

      return {
        rows: Array.from(result),
      } satisfies ExplainResult<Record<string, unknown>>
    },
  }
}

async function executeQuery<TRows extends object[]>(
  sql: BunSqlExecutor,
  text: string,
  parameters: readonly unknown[],
  signal: AbortSignal | undefined,
): Promise<TRows> {
  throwIfAborted(signal)
  const query = sql.unsafe<TRows>(text, parameters)

  if (signal === undefined) {
    return await query
  }

  // Bun's SQLite backend may execute synchronously, so an abort cannot interrupt the native call
  // once it has started. The query handle still enables cancellation for asynchronous backends.
  if (signal.aborted) {
    query.cancel()
    throwIfAborted(signal)
  }

  const cancel = () => query.cancel()

  signal.addEventListener("abort", cancel, { once: true })
  try {
    const result = await query

    throwIfAborted(signal)
    return result
  } finally {
    signal.removeEventListener("abort", cancel)
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  signal?.throwIfAborted()
}
