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
import {
  booleanResultDecoder,
  dateResultDecoder,
  jsonTextResultDecoder,
  timestampResultDecoder,
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

const sqliteDecoders = Object.freeze({
  boolean: booleanResultDecoder,
  date: dateResultDecoder,
  json: jsonTextResultDecoder,
  timestamp: timestampResultDecoder,
})

const defaultEncoder: DriverValueEncoder<SQLInputValue> = {
  encode(value, sqlType) {
    if (value === null) {
      return null
    }

    if (sqlType === "boolean" && typeof value === "boolean") {
      return value ? 1 : 0
    }

    if ((sqlType === "date" || sqlType === "timestamp") && value instanceof Date) {
      return encodeDate(value, sqlType)
    }

    if (sqlType === "json") {
      return encodeJson(value)
    }

    if (isSqliteInputValue(value)) {
      return value
    }

    throw new TypeError(
      "node:sqlite parameters must be null, number, bigint, string, or an ArrayBuffer view; encode objects with a SQL type or custom encoder",
    )
  },
}

/** Adapt one application-owned `node:sqlite` database. */
export function nodeSqliteAdapter(
  database: DatabaseSync,
  options: NodeSqliteAdapterOptions = {},
): NodeSqliteAdapter {
  const encoder = options.encoder ?? defaultEncoder
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
          return rollbackAndRethrow(database, error)
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
    decoders: sqliteDecoders,
    async execute<TRow extends object>(request: ExecutionRequest) {
      throwIfAborted(request.signal)
      const statement = database.prepare(request.statement.text)
      statement.setReturnArrays(false)
      const parameters = encodeParameters(request, encoder)

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
      } satisfies ExecutionResult<TRow>
    },
    async explain(request: ExplainRequest) {
      throwIfAborted(request.signal)
      const statement = database.prepare(request.statement.text)
      statement.setReturnArrays(false)
      const parameters = encodeParameters(request, encoder)

      return {
        rows: statement.all(...parameters).map((row) => ({ ...row })),
      } satisfies ExplainResult<Record<string, unknown>>
    },
  }
}

function encodeParameters(
  request: ExecutionRequest,
  encoder: DriverValueEncoder<SQLInputValue>,
): SQLInputValue[] {
  return request.statement.parameters.map((value, index) =>
    encoder.encode(value, request.statement.parameterSqlTypes?.[index]),
  )
}

function encodeDate(value: Date, sqlType: "date" | "timestamp"): string {
  if (Number.isNaN(value.getTime())) {
    throw new TypeError(`node:sqlite ${sqlType} parameters must be valid Date values`)
  }

  const iso = value.toISOString()
  return sqlType === "date" ? iso.slice(0, 10) : iso
}

function encodeJson(value: unknown): string {
  try {
    const encoded = JSON.stringify(value)

    if (encoded === undefined) {
      throw new TypeError("value is not JSON-serializable")
    }

    return encoded
  } catch (error) {
    throw new TypeError("node:sqlite JSON parameters must be JSON-serializable", {
      cause: error,
    })
  }
}

function isSqliteInputValue(value: unknown): value is SQLInputValue {
  return (
    typeof value === "number" ||
    typeof value === "bigint" ||
    typeof value === "string" ||
    ArrayBuffer.isView(value)
  )
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  signal?.throwIfAborted()
}

function rollbackAndRethrow(database: DatabaseSync, error: unknown): never {
  if (database.isTransaction) {
    try {
      database.exec("ROLLBACK")
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], "Transaction failed and rollback failed", {
        cause: error,
      })
    }
  }

  throw error
}
