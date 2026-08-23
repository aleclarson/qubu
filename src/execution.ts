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

/** Controls the lifecycle of one adapter-owned transaction. */
export interface TransactionOptions {
  /** Passed to the adapter for transaction begin, commit, and rollback. */
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

/**
 * An adapter that can pin one driver connection for a callback transaction.
 * The callback receives an adapter scoped to that transaction. Qubu does not
 * issue transaction SQL or manage the driver's connection lifecycle.
 */
export interface TransactionalQueryAdapter extends QueryAdapter {
  transaction<T>(
    callback: (adapter: QueryAdapter) => Promise<T>,
    options?: TransactionOptions
  ): Promise<T>
}

/** A query client with one application-owned adapter bound to every call. */
export interface QubuClient<TAdapter extends QueryAdapter = QueryAdapter> {
  /** The adapter supplied to {@link qubu}. */
  readonly adapter: TAdapter
  /** Execute a query and keep the adapter's structured mutation facts. */
  execute<TRow extends object>(
    query: Query<TRow, any, any, any>,
    options?: ExecutionOptions
  ): Promise<ExecutionResult<TRow>>
  /** Execute a query and return only its decoded rows. */
  rows<TRow extends object>(
    query: Query<TRow, any, any, any>,
    options?: ExecutionOptions
  ): Promise<readonly TRow[]>
}

/** The client available inside a transaction callback. */
export type QubuTransaction = QubuClient<QueryAdapter>

/** A bound client whose adapter supports transaction-scoped execution. */
export interface QubuTransactionalClient<
  TAdapter extends TransactionalQueryAdapter = TransactionalQueryAdapter,
> extends QubuClient<TAdapter> {
  /** Run several queries on one adapter-owned transaction. */
  transaction<T>(
    callback: (transaction: QubuTransaction) => Promise<T>,
    options?: TransactionOptions
  ): Promise<T>
}

/** Bind an application-owned adapter once for repeated query execution. */
export function qubu<TAdapter extends TransactionalQueryAdapter>(
  adapter: TAdapter
): QubuTransactionalClient<TAdapter>
export function qubu<TAdapter extends QueryAdapter>(
  adapter: TAdapter
): QubuClient<TAdapter>
export function qubu<TAdapter extends QueryAdapter>(
  adapter: TAdapter
):
  | QubuClient<TAdapter>
  | QubuTransactionalClient<TAdapter & TransactionalQueryAdapter> {
  const client = createClient(adapter)
  if (!isTransactionalQueryAdapter(adapter)) return client

  return Object.freeze({
    ...client,
    transaction<T>(
      callback: (transaction: QubuTransaction) => Promise<T>,
      options?: TransactionOptions
    ) {
      return adapter.transaction(
        async transactionAdapter => callback(createClient(transactionAdapter)),
        options
      )
    },
  }) as QubuTransactionalClient<TAdapter & TransactionalQueryAdapter>
}

function createClient<TAdapter extends QueryAdapter>(
  adapter: TAdapter
): QubuClient<TAdapter> {
  return Object.freeze({
    adapter,
    execute<TRow extends object>(
      query: Query<TRow, any, any, any>,
      options?: ExecutionOptions
    ) {
      return execute(query, adapter, options)
    },
    rows<TRow extends object>(
      query: Query<TRow, any, any, any>,
      options?: ExecutionOptions
    ) {
      return executeRows(query, adapter, options)
    },
  })
}

function isTransactionalQueryAdapter(
  adapter: QueryAdapter
): adapter is TransactionalQueryAdapter {
  return (
    typeof (adapter as Partial<TransactionalQueryAdapter>).transaction ===
    'function'
  )
}

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
