import type { DatabaseSync, SQLInputValue } from "node:sqlite"

import type {
  DriverValueEncoder,
  ExecutionRequest,
  ExecutionResult,
  ExplainableQueryAdapter,
  ExplainRequest,
  ExplainResult,
  TransactionOptions,
  TransactionalQueryAdapter,
  NestedTransactionalQueryAdapter,
} from "qubu"
import { sqliteDialect } from "qubu/sqlite"

import { runSavepointScope, guardTransactionConnection } from "../../shared/savepoints.ts"

export type NodeSqliteTransactionMode = "deferred" | "immediate" | "exclusive"

export interface NodeSqliteAdapterOptions {
  readonly encoder?: DriverValueEncoder<SQLInputValue>
  readonly transactionMode?: NodeSqliteTransactionMode
}

export interface NodeSqliteTransactionAdapter
  extends
    ExplainableQueryAdapter<Record<string, unknown>>,
    NestedTransactionalQueryAdapter<ExplainableQueryAdapter<Record<string, unknown>>> {}

export interface NodeSqliteAdapter
  extends
    ExplainableQueryAdapter<Record<string, unknown>>,
    TransactionalQueryAdapter<NodeSqliteTransactionAdapter> {
  readonly database: DatabaseSync
  readonly transactionMode: NodeSqliteTransactionMode
}

const identityEncoder: DriverValueEncoder<SQLInputValue> = {
  encode(value) {
    return value as SQLInputValue
  },
}

/** Adapt one application-owned `node:sqlite` database. */
export function nodeSqliteAdapter(
  database: DatabaseSync,
  options: NodeSqliteAdapterOptions = {},
): NodeSqliteAdapter {
  const encoder = options.encoder ?? identityEncoder
  const transactionMode = options.transactionMode ?? "immediate"
  const scoped = executionAdapter(database, encoder)

  const guard = guardTransactionConnection(scoped)

  return {
    ...guard.adapter,
    database,
    transactionMode,
    async transaction<T>(
      callback: (adapter: NodeSqliteTransactionAdapter) => Promise<T>,
      transactionOptions: TransactionOptions = {},
    ): Promise<T> {
      const releaseGuard = guard.acquire()

      try {
        throwIfAborted(transactionOptions.signal)
        database.exec(`BEGIN ${transactionMode.toUpperCase()}`)
        try {
          const result = await runSavepointScope(scoped, (sql) => database.exec(sql), callback)

          throwIfAborted(transactionOptions.signal)
          database.exec("COMMIT")
          return result
        } catch (error) {
          if (database.isTransaction) {
            try {
              database.exec("ROLLBACK")
            } catch (rollbackError) {
              throw new AggregateError(
                [error, rollbackError],
                "Transaction failed and rollback failed",
                { cause: error },
              )
            }
          }

          throw error
        }
      } finally {
        releaseGuard?.()
      }
    },
  }
}

function executionAdapter(
  database: DatabaseSync,
  encoder: DriverValueEncoder<SQLInputValue>,
): ExplainableQueryAdapter<Record<string, unknown>> {
  return {
    dialect: sqliteDialect(),
    async execute<TRow extends object>(request: ExecutionRequest) {
      throwIfAborted(request.signal)
      const statement = database.prepare(request.statement.text)
      const parameters = request.statement.parameters.map((value, index) =>
        encoder.encode(value, request.statement.parameterSqlTypes?.[index]),
      )

      if (statement.columns().length > 0) {
        return {
          rows: statement
            .all(...parameters)
            .map((row) => ({ ...row })) as unknown as readonly TRow[],
        }
      }

      const result = statement.run(...parameters)

      return {
        rows: [],
        affectedRows: result.changes,
        ...(request.queryKind === "insert" ? { insertId: result.lastInsertRowid } : {}),
      } satisfies ExecutionResult<TRow>
    },
    async explain(request: ExplainRequest) {
      throwIfAborted(request.signal)
      const statement = database.prepare(request.statement.text)
      const parameters = request.statement.parameters.map((value, index) =>
        encoder.encode(value, request.statement.parameterSqlTypes?.[index]),
      )

      return {
        rows: statement.all(...parameters).map((row) => ({ ...row })),
      } satisfies ExplainResult<Record<string, unknown>>
    },
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  signal?.throwIfAborted()
}
