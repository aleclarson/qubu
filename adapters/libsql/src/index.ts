import type {
  Client,
  InStatement,
  InValue,
  ResultSet,
  Row,
  Transaction,
  TransactionMode,
} from "@libsql/client"
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
import { sqliteDialect } from "qubu/sqlite"

export interface LibsqlAdapterOptions {
  readonly encoder?: DriverValueEncoder<InValue>
  readonly transactionMode?: TransactionMode
}

export interface LibsqlTransactionAdapter extends ExplainableQueryAdapter<Row> {}

export interface LibsqlAdapter
  extends ExplainableQueryAdapter<Row>, TransactionalQueryAdapter<LibsqlTransactionAdapter> {
  readonly client: Client
  readonly transactionMode: TransactionMode
}

interface LibsqlExecutor {
  execute(statement: InStatement): Promise<ResultSet>
}

const identityEncoder: DriverValueEncoder<InValue> = {
  encode(value) {
    return value as InValue
  },
}

/** Adapt an application-owned `@libsql/client` for Qubu execution. */
export function libsqlAdapter(client: Client, options: LibsqlAdapterOptions = {}): LibsqlAdapter {
  const encoder = options.encoder ?? identityEncoder
  const transactionMode = options.transactionMode ?? "write"

  return {
    client,
    dialect: sqliteDialect(),
    transactionMode,
    execute(request) {
      return executeRequest(client, request, encoder)
    },
    explain(request) {
      return explainRequest(client, request, encoder)
    },
    async transaction<T>(
      callback: (adapter: LibsqlTransactionAdapter) => Promise<T>,
      transactionOptions: TransactionOptions = {},
    ): Promise<T> {
      throwIfAborted(transactionOptions.signal)
      const transaction = await client.transaction(transactionMode)
      const adapter = transactionAdapter(transaction, encoder)

      try {
        throwIfAborted(transactionOptions.signal)
        const result = await callback(adapter)

        throwIfAborted(transactionOptions.signal)
        await transaction.commit()
        return result
      } catch (error) {
        if (!transaction.closed) {
          await transaction.rollback()
        }

        throw error
      } finally {
        transaction.close()
      }
    },
  }
}

function transactionAdapter(
  transaction: Transaction,
  encoder: DriverValueEncoder<InValue>,
): LibsqlTransactionAdapter {
  return {
    dialect: sqliteDialect(),
    execute(request) {
      return executeRequest(transaction, request, encoder)
    },
    explain(request) {
      return explainRequest(transaction, request, encoder)
    },
  }
}

async function executeRequest<TRow extends object>(
  executor: LibsqlExecutor,
  request: ExecutionRequest,
  encoder: DriverValueEncoder<InValue>,
): Promise<ExecutionResult<TRow>> {
  throwIfAborted(request.signal)
  const result = await executor.execute(statement(request, encoder))
  const isMutation = request.queryKind !== "select" && request.queryKind !== "set"

  return {
    rows: result.rows as unknown as readonly TRow[],
    ...(isMutation ? { affectedRows: result.rowsAffected } : {}),
    ...(request.queryKind === "insert" && result.lastInsertRowid !== undefined
      ? { insertId: result.lastInsertRowid }
      : {}),
  }
}

async function explainRequest(
  executor: LibsqlExecutor,
  request: ExplainRequest,
  encoder: DriverValueEncoder<InValue>,
): Promise<ExplainResult<Row>> {
  throwIfAborted(request.signal)
  const result = await executor.execute(statement(request, encoder))

  return { rows: result.rows }
}

function statement(request: ExecutionRequest, encoder: DriverValueEncoder<InValue>): InStatement {
  return {
    sql: request.statement.text,
    args: request.statement.parameters.map((value) => encoder.encode(value)),
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  signal?.throwIfAborted()
}
