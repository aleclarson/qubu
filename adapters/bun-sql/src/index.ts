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
import { sqliteDialect } from "qubu/sqlite"

export interface BunSqlResult<TRow extends object = Record<string, unknown>> extends Array<TRow> {
  readonly count?: number
}

export interface BunSqlExecutor {
  unsafe<TRows extends object[]>(text: string, parameters?: readonly unknown[]): PromiseLike<TRows>
}

export interface BunSqlClient extends BunSqlExecutor {
  begin<T>(callback: (transaction: BunSqlExecutor) => Promise<T>): Promise<T>
}

export interface BunSqlAdapterOptions {
  readonly dialect?: Dialect
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

/** Adapt one application-owned `Bun.SQL` client. */
export function bunSqlAdapter(
  sql: BunSqlClient,
  options: BunSqlAdapterOptions = {},
): BunSqlAdapter {
  const dialect = options.dialect ?? sqliteDialect()
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
      throwIfAborted(request.signal)
      const result = (await sql.unsafe<TRow[]>(
        request.statement.text,
        request.statement.parameters.map((value, index) =>
          encoder.encode(value, request.statement.parameterSqlTypes?.[index]),
        ),
      )) as BunSqlResult<TRow>
      const isMutation = request.queryKind !== "select" && request.queryKind !== "set"

      return {
        rows: Array.from(result),
        ...(isMutation && result.count !== undefined ? { affectedRows: result.count } : {}),
      } satisfies ExecutionResult<TRow>
    },
    async explain(request: ExplainRequest) {
      throwIfAborted(request.signal)
      const result = await sql.unsafe<Record<string, unknown>[]>(
        request.statement.text,
        request.statement.parameters.map((value, index) =>
          encoder.encode(value, request.statement.parameterSqlTypes?.[index]),
        ),
      )

      return {
        rows: Array.from(result),
      } satisfies ExplainResult<Record<string, unknown>>
    },
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  signal?.throwIfAborted()
}
