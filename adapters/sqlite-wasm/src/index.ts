import type {
  BindableValue,
  Database as OfficialSqliteWasmDatabase,
  PreparedStatement as OfficialSqliteWasmPreparedStatement,
} from "@sqlite.org/sqlite-wasm"
import type {
  DriverValueEncoder,
  ExecutionRequest,
  ExecutionResult,
  ExplainableQueryAdapter,
  ExplainRequest,
  ExplainResult,
} from "qubu"
import { sqliteDialect } from "qubu/sqlite"

/** Values accepted by the official SQLite WASM OO1 binding API. */
export type SqliteWasmValue = BindableValue

/** The prepared-statement surface used by this adapter. */
export type SqliteWasmPreparedStatement = Pick<
  OfficialSqliteWasmPreparedStatement,
  "bind" | "columnCount" | "finalize" | "get" | "step"
>

/** The official SQLite WASM OO1 database surface used by this adapter. */
export type SqliteWasmDatabase = Pick<
  OfficialSqliteWasmDatabase,
  "changes" | "close" | "prepare" | "selectValue"
>

export interface SqliteWasmAdapterOptions {
  /** Convert Qubu values before the official SQLite binding API receives them. */
  readonly encoder?: DriverValueEncoder<SqliteWasmValue>
}

export interface SqliteWasmAdapter extends ExplainableQueryAdapter<Record<string, unknown>> {
  readonly database: SqliteWasmDatabase
  /** Close the adapted database. Repeated calls are safe. */
  close(): void
}

const identityEncoder: DriverValueEncoder<SqliteWasmValue> = {
  encode(value) {
    return value as SqliteWasmValue
  },
}

/**
 * Adapt an official `sqlite3.oo1.DB` handle for Qubu execution.
 *
 * The adapter does not create or terminate a worker. The caller owns the worker that contains the
 * database and should call `close()` before it exits.
 */
export function sqliteWasmAdapter(
  database: SqliteWasmDatabase,
  options: SqliteWasmAdapterOptions = {},
): SqliteWasmAdapter {
  const encoder = options.encoder ?? identityEncoder
  let closed = false

  return {
    database,
    dialect: sqliteDialect(),
    async execute<TRow extends object>(request: ExecutionRequest) {
      return executeRequest<TRow>(database, encoder, request, true)
    },
    async explain(request: ExplainRequest) {
      const result = await executeRequest<Record<string, unknown>>(
        database,
        encoder,
        request,
        false,
      )

      return { rows: result.rows } satisfies ExplainResult<Record<string, unknown>>
    },
    close() {
      if (closed) {
        return
      }
      closed = true
      database.close()
    },
  }
}

/** Alias with the package's full provider name. */
export const officialSqliteWasmAdapter = sqliteWasmAdapter

async function executeRequest<TRow extends object>(
  database: SqliteWasmDatabase,
  encoder: DriverValueEncoder<SqliteWasmValue>,
  request: ExecutionRequest,
  includeMutationMetadata: boolean,
): Promise<ExecutionResult<TRow>> {
  request.signal?.throwIfAborted()
  const statement = database.prepare(request.statement.text)
  let rows: readonly Record<string, unknown>[] = []

  try {
    const parameters = request.statement.parameters.map((value) => encoder.encode(value))
    if (parameters.length > 0) {
      statement.bind(parameters)
    }

    if (statement.columnCount > 0) {
      const resultRows: Record<string, unknown>[] = []
      while (statement.step()) {
        resultRows.push({ ...statement.get({}) })
      }
      rows = resultRows
    } else {
      statement.step()
    }
  } finally {
    statement.finalize()
  }

  const isMutation = request.queryKind !== "select" && request.queryKind !== "set"
  if (!includeMutationMetadata || !isMutation) {
    return { rows: rows as readonly TRow[] }
  }

  const insertId =
    request.queryKind === "insert" ? database.selectValue("SELECT last_insert_rowid()") : undefined

  return {
    rows: rows as readonly TRow[],
    affectedRows: database.changes(),
    ...(isInsertId(insertId) ? { insertId } : {}),
  } satisfies ExecutionResult<TRow>
}

function isInsertId(value: unknown): value is string | number | bigint {
  return typeof value === "string" || typeof value === "number" || typeof value === "bigint"
}
