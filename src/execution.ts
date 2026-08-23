import type { Dialect } from './core/dialect.ts'
import {
  render,
  type RenderedQuery,
  type RenderOptions,
} from './core/render.ts'
import type { Query } from './query/types.ts'

/**
 * The driver-facing boundary. `parameters` are raw application values in the
 * same order as the placeholders in `text`; the adapter binds and encodes
 * them for its driver. Connection pooling, transactions, retries, and row
 * decoding remain adapter concerns.
 */
export interface QueryAdapter {
  readonly dialect: Dialect
  execute<TRow extends object>(
    statement: RenderedQuery
  ): Promise<readonly TRow[]>
}

export type QueryExecutor = QueryAdapter

export interface DriverValueEncoder<TDriverValue = unknown> {
  /** Convert one Qubu parameter into the driver's bindable representation. */
  encode(value: unknown): TDriverValue
}

export function execute<TRow extends object>(
  query: Query<TRow, any, any, any>,
  adapter: QueryAdapter,
  options?: RenderOptions
): Promise<readonly TRow[]>
export function execute<TRow extends object>(
  adapter: QueryAdapter,
  query: Query<TRow, any, any, any>,
  options?: RenderOptions
): Promise<readonly TRow[]>
export async function execute<TRow extends object>(
  first: Query<TRow, any, any, any> | QueryAdapter,
  second: Query<TRow, any, any, any> | QueryAdapter,
  options: RenderOptions = {}
): Promise<readonly TRow[]> {
  const query = isQuery(first) ? first : (second as Query<TRow, any, any, any>)
  const adapter = isQuery(first) ? (second as QueryAdapter) : first
  const statement = render(query, {
    dialect: options.dialect ?? adapter.dialect,
  })

  // Deliberately do not catch or wrap driver errors. Adapters own their
  // driver's error type and transaction/connection lifecycle.
  return adapter.execute<TRow>(statement)
}

function isQuery(
  value: Query<any, any, any, any> | QueryAdapter
): value is Query<any, any, any, any> {
  return 'render' in value && typeof value.render === 'function'
}
