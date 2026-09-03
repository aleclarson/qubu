import type {
  DriverValueEncoder,
  ExecutionRequest,
  ExecutionResult,
  ExplainableQueryAdapter,
  ExplainRequest,
  ExplainResult,
} from "qubu"
import {
  booleanResultDecoder,
  dateResultDecoder,
  jsonTextResultDecoder,
  timestampResultDecoder,
} from "qubu"
import { sqliteDialect } from "qubu/sqlite"

export interface D1ResultMeta {
  readonly changes?: number
  readonly last_row_id?: number
}

export interface D1Result<TRow extends object = Record<string, unknown>> {
  readonly results?: readonly TRow[]
  readonly meta?: D1ResultMeta
}

export interface D1PreparedStatement {
  bind(...values: readonly unknown[]): D1PreparedStatement
  all<TRow extends object>(): Promise<D1Result<TRow>>
  run(): Promise<D1Result>
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement
}

export interface D1AdapterOptions {
  readonly encoder?: DriverValueEncoder
}

export interface D1Adapter extends ExplainableQueryAdapter<Record<string, unknown>> {
  readonly database: D1Database
}

/** Adapt one application-owned Cloudflare D1 binding. */
export function d1Adapter(database: D1Database, options: D1AdapterOptions = {}): D1Adapter {
  return {
    database,
    dialect: sqliteDialect(),
    // D1 reads SQLite booleans as 0/1 and text-backed date, timestamp, and JSON values as strings.
    decoders: {
      boolean: booleanResultDecoder,
      date: dateResultDecoder,
      timestamp: timestampResultDecoder,
      json: jsonTextResultDecoder,
    },
    async execute<TRow extends object>(request: ExecutionRequest) {
      throwIfAborted(request.signal)
      const statement = database
        .prepare(request.statement.text)
        .bind(
          ...request.statement.parameters.map((value) => encodeD1Parameter(value, options.encoder)),
        )

      if (request.queryKind === "select" || request.queryKind === "set") {
        const result = await statement.all<TRow>()

        return { rows: result.results ?? [] }
      }

      const result = await statement.run()
      const insertId = request.queryKind === "insert" ? validInsertId(result.meta) : undefined

      return {
        rows: (result.results ?? []) as readonly TRow[],
        ...(result.meta?.changes === undefined ? {} : { affectedRows: result.meta.changes }),
        ...(insertId === undefined ? {} : { insertId }),
      } satisfies ExecutionResult<TRow>
    },
    async explain(request: ExplainRequest) {
      throwIfAborted(request.signal)
      const result = await database
        .prepare(request.statement.text)
        .bind(
          ...request.statement.parameters.map((value) => encodeD1Parameter(value, options.encoder)),
        )
        .all<Record<string, unknown>>()

      return {
        rows: result.results ?? [],
      } satisfies ExplainResult<Record<string, unknown>>
    },
  }
}

function encodeD1Parameter(value: unknown, encoder: DriverValueEncoder | undefined): unknown {
  // Validate the encoded value because D1 sees the result after any custom encoder or column codec.
  const encoded = encoder === undefined ? value : encoder.encode(value)

  if (
    encoded === null ||
    typeof encoded === "number" ||
    typeof encoded === "string" ||
    typeof encoded === "boolean" ||
    encoded instanceof ArrayBuffer ||
    ArrayBuffer.isView(encoded)
  ) {
    return encoded
  }

  throw new TypeError(
    "Cloudflare D1 parameters must be null, number, string, boolean, ArrayBuffer, or an ArrayBuffer view",
  )
}

function validInsertId(meta: D1ResultMeta | undefined): number | undefined {
  // D1 exposes SQLite's connection-level last_insert_rowid(), which ignored or WITHOUT ROWID
  // inserts do not update, and large rowids cannot be represented safely by JavaScript numbers.
  if (meta?.changes === undefined || meta.changes <= 0) {
    return undefined
  }

  const insertId = meta.last_row_id

  return insertId !== undefined && insertId !== 0 && Number.isSafeInteger(insertId)
    ? insertId
    : undefined
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  signal?.throwIfAborted()
}
