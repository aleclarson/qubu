import type { Dialect } from './core/dialect.ts'
import {
  render,
  type RenderedQuery,
  type RenderOptions,
} from './core/render.ts'
import type { Query, QueryKind } from './query/types.ts'

/** Rendering policy and cancellation input accepted by query execution. */
export interface ExecutionOptions extends RenderOptions {
  /** Passed to the application adapter for drivers that support cancellation. */
  readonly signal?: AbortSignal
}

/** One rendered statement and the controls passed to an application adapter. */
export interface ExecutionRequest {
  /** SQL text and raw application parameters produced by Qubu's renderer. */
  readonly statement: RenderedQuery
  /** The source query kind, available without parsing rendered SQL. */
  readonly queryKind: QueryKind
  /** Present when the caller supplied an abort signal to {@link execute}. */
  readonly signal?: AbortSignal
}

/**
 * Driver-neutral rows and optional mutation facts returned by an adapter.
 *
 * Adapters normalize driver result fields into this shape. They should omit a
 * mutation fact when the driver cannot report it accurately.
 */
export interface ExecutionResult<
  TRow extends object = Record<string, unknown>,
> {
  /** Decoded result rows. Mutations without `RETURNING` use an empty array. */
  readonly rows: readonly TRow[]
  /** Rows inserted, updated, or deleted when the driver reports that count. */
  readonly affectedRows?: number | bigint
  /** Rows whose stored values changed when distinct from affected rows. */
  readonly changedRows?: number | bigint
  /** An insert identifier reported by the driver, including generated IDs. */
  readonly insertId?: string | number | bigint
}

/**
 * The driver-facing boundary. `request.statement.parameters` contains raw
 * application values in placeholder order; the adapter binds and encodes them
 * for its driver. Connection pooling, transactions, retries, and row decoding
 * remain adapter concerns.
 */
export interface QueryAdapter {
  /** Default rendering policy for queries sent through this adapter. */
  readonly dialect: Dialect
  /** Execute one request and normalize the driver's result fields. */
  execute<TRow extends object>(
    request: ExecutionRequest
  ): Promise<ExecutionResult<TRow>>
}

export type QueryExecutor = QueryAdapter

export interface DriverValueEncoder<TDriverValue = unknown> {
  /** Convert one Qubu parameter into the driver's bindable representation. */
  encode(value: unknown): TDriverValue
}

/**
 * Render a typed query, pass it to an application adapter, and return the
 * adapter's structured result unchanged.
 *
 * Driver errors are not caught or translated.
 */
export function execute<TRow extends object>(
  query: Query<TRow, any, any, any>,
  adapter: QueryAdapter,
  options?: ExecutionOptions
): Promise<ExecutionResult<TRow>>
export function execute<TRow extends object>(
  adapter: QueryAdapter,
  query: Query<TRow, any, any, any>,
  options?: ExecutionOptions
): Promise<ExecutionResult<TRow>>
export function execute<TRow extends object>(
  first: Query<TRow, any, any, any> | QueryAdapter,
  second: Query<TRow, any, any, any> | QueryAdapter,
  options: ExecutionOptions = {}
): Promise<ExecutionResult<TRow>> {
  return executeInternal(first, second, options)
}

/** Execute a query and return its decoded rows without mutation facts. */
export function executeRows<TRow extends object>(
  query: Query<TRow, any, any, any>,
  adapter: QueryAdapter,
  options?: ExecutionOptions
): Promise<readonly TRow[]>
export function executeRows<TRow extends object>(
  adapter: QueryAdapter,
  query: Query<TRow, any, any, any>,
  options?: ExecutionOptions
): Promise<readonly TRow[]>
export async function executeRows<TRow extends object>(
  first: Query<TRow, any, any, any> | QueryAdapter,
  second: Query<TRow, any, any, any> | QueryAdapter,
  options: ExecutionOptions = {}
): Promise<readonly TRow[]> {
  const result = await executeInternal(first, second, options)
  return result.rows
}

async function executeInternal<TRow extends object>(
  first: Query<TRow, any, any, any> | QueryAdapter,
  second: Query<TRow, any, any, any> | QueryAdapter,
  options: ExecutionOptions
): Promise<ExecutionResult<TRow>> {
  const query = isQuery(first) ? first : (second as Query<TRow, any, any, any>)
  const adapter = isQuery(first) ? (second as QueryAdapter) : first
  const statement = render(query, {
    dialect: options.dialect ?? adapter.dialect,
  })
  const request: ExecutionRequest = Object.freeze({
    statement,
    queryKind: query.queryKind,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })

  // Deliberately do not catch or wrap driver errors. Adapters own their
  // driver's error type and transaction/connection lifecycle.
  return adapter.execute<TRow>(request)
}

function isQuery(
  value: Query<any, any, any, any> | QueryAdapter
): value is Query<any, any, any, any> {
  return 'render' in value && typeof value.render === 'function'
}
