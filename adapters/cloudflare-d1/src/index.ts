import type {
  DriverValueEncoder,
  ExecutionRequest,
  ExecutionResult,
  ExplainableQueryAdapter,
  ExplainRequest,
  ExplainResult,
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

const identityEncoder: DriverValueEncoder = { encode: (value) => value }

/** Adapt one application-owned Cloudflare D1 binding. */
export function d1Adapter(database: D1Database, options: D1AdapterOptions = {}): D1Adapter {
  const encoder = options.encoder ?? identityEncoder

  return {
    database,
    dialect: sqliteDialect(),
    async execute<TRow extends object>(request: ExecutionRequest) {
      throwIfAborted(request.signal)
      const statement = database
        .prepare(request.statement.text)
        .bind(
          ...request.statement.parameters.map((value, index) =>
            encoder.encode(value, request.statement.parameterSqlTypes?.[index]),
          ),
        )

      if (request.queryKind === "select" || request.queryKind === "set") {
        const result = await statement.all<TRow>()

        return { rows: result.results ?? [] }
      }

      const result = await statement.run()

      return {
        rows: (result.results ?? []) as readonly TRow[],
        ...(result.meta?.changes === undefined ? {} : { affectedRows: result.meta.changes }),
        ...(request.queryKind === "insert" && result.meta?.last_row_id !== undefined
          ? { insertId: result.meta.last_row_id }
          : {}),
      } satisfies ExecutionResult<TRow>
    },
    async explain(request: ExplainRequest) {
      throwIfAborted(request.signal)
      const result = await database
        .prepare(request.statement.text)
        .bind(
          ...request.statement.parameters.map((value, index) =>
            encoder.encode(value, request.statement.parameterSqlTypes?.[index]),
          ),
        )
        .all<Record<string, unknown>>()

      return {
        rows: result.results ?? [],
      } satisfies ExplainResult<Record<string, unknown>>
    },
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  signal?.throwIfAborted()
}
