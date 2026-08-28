import type { Dialect, ExplainRenderOptions } from "./core/dialect.ts"
import { render, type RenderedQuery, type RenderOptions } from "./core/render.ts"
import { queryValidationError } from "./query/errors.ts"
import type { AnyQuery, QueryKind, QueryWithRow } from "./query/types.ts"
import { decodeResultRow, type ResultDecoders, type ResultShape } from "./result.ts"

export type StreamableQuery<TRow extends object = Record<string, unknown>> = QueryWithRow<TRow> & {
  readonly queryKind: "select" | "set"
}

/** Rendering policy and cancellation input accepted by query execution. */
export interface ExecutionOptions extends RenderOptions {
  /** Passed to the application adapter for drivers that support cancellation. */
  readonly signal?: AbortSignal
}

/** Rendering, EXPLAIN, and cancellation options for plan requests. */
export interface ExplainOptions extends RenderOptions, ExplainRenderOptions {
  /** Passed to the application adapter for drivers that support cancellation. */
  readonly signal?: AbortSignal
}

/** EXPLAIN options accepted for SELECT and set-operation queries. */
export type ExplainReadOptions = ExplainOptions

/** EXPLAIN options for mutations, which never run with analysis enabled. */
export type ExplainMutationOptions = Omit<ExplainOptions, "analyze"> & {
  readonly analyze?: never
}

/** Select read-only or plan-only EXPLAIN options from the query kind. */
export type ExplainOptionsFor<TQuery extends AnyQuery> = TQuery["queryKind"] extends
  | "select"
  | "set"
  ? ExplainReadOptions
  : ExplainMutationOptions

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
  /** Named logical fields used by Qubu after the adapter returns raw rows. */
  readonly resultShape: ResultShape
  /** Present when the caller supplied an abort signal to {@link execute} or {@link stream}. */
  readonly signal?: AbortSignal
}

/** One rendered EXPLAIN statement and the controls passed to an adapter. */
export interface ExplainRequest extends ExecutionRequest {}

/**
 * Driver-neutral rows and optional mutation facts returned by an adapter.
 *
 * Adapters normalize driver result fields into this shape. They should omit a mutation fact when
 * the driver cannot report it accurately.
 */
export interface ExecutionResult<TRow extends object = Record<string, unknown>> {
  /** Decoded result rows. Mutations without `RETURNING` use an empty array. */
  readonly rows: readonly TRow[]
  /** Rows inserted, updated, or deleted when the driver reports that count. */
  readonly affectedRows?: number | bigint
  /** Rows whose stored values changed when distinct from affected rows. */
  readonly changedRows?: number | bigint
  /** An insert identifier reported by the driver, including generated IDs. */
  readonly insertId?: string | number | bigint
}

/** Driver-normalized rows and mutation facts returned to Qubu by an adapter. */
export interface AdapterExecutionResult {
  /** Object rows keyed by the query's rendered result aliases. */
  readonly rows: readonly Readonly<Record<string, unknown>>[]
  readonly affectedRows?: number | bigint
  readonly changedRows?: number | bigint
  readonly insertId?: string | number | bigint
}

/** Adapter-decoded vendor plan rows returned by an EXPLAIN request. */
export interface ExplainResult<TPlanRow extends object = Record<string, unknown>> {
  /** Opaque plan rows in the shape selected by the application adapter. */
  readonly rows: readonly TPlanRow[]
}

/**
 * The driver-facing boundary. `request.statement.parameters` contains raw application values in
 * placeholder order; the adapter binds and encodes them for its driver. Connection pooling,
 * transactions, retries, and proprietary driver-row normalization remain adapter concerns. Qubu
 * applies the adapter's registered logical result decoders afterward.
 */
export interface QueryAdapter {
  /** Default rendering policy for queries sent through this adapter. */
  readonly dialect: Dialect
  /** Driver-specific conversions for portable logical result domains. */
  readonly decoders?: ResultDecoders
  /** Execute one request and normalize the driver's result fields. */
  execute(request: ExecutionRequest): Promise<AdapterExecutionResult>
}

/**
 * An opt-in adapter capability for typed, adapter-decoded EXPLAIN results.
 *
 * Qubu renders and validates the statement. The adapter binds parameters, executes the plan
 * request, owns cancellation and connection lifecycle, and decodes vendor-specific plan rows
 * without a cross-dialect Qubu plan tree.
 */
export interface ExplainableQueryAdapter<
  TPlanRow extends object = Record<string, unknown>,
> extends QueryAdapter {
  explain(request: ExplainRequest): Promise<ExplainResult<TPlanRow>>
}

/** Extract the plan-row type owned by an explainable adapter. */
export type ExplainPlanRow<TAdapter extends ExplainableQueryAdapter> =
  TAdapter extends ExplainableQueryAdapter<infer TPlanRow> ? TPlanRow : never

/**
 * An opt-in adapter capability for streaming rows from read queries.
 *
 * The adapter owns the returned iterator and every resource behind it. The iterator must release
 * those resources when it completes, is closed early, fails, or observes an aborted request
 * signal.
 */
export interface StreamingQueryAdapter extends QueryAdapter {
  /** Return an adapter-owned object-row stream for one SELECT or set query. */
  stream(request: ExecutionRequest): AsyncIterable<Readonly<Record<string, unknown>>>
}

export type QueryExecutor = QueryAdapter

/**
 * An adapter that can pin one driver connection for a callback transaction. The callback receives
 * an adapter scoped to that transaction. Qubu does not issue transaction SQL or manage the driver's
 * connection lifecycle.
 */
export interface TransactionalQueryAdapter<
  TTransactionAdapter extends QueryAdapter = QueryAdapter,
> extends QueryAdapter {
  transaction<T>(
    callback: (adapter: TTransactionAdapter) => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T>
}

type TransactionAdapterOf<TAdapter extends TransactionalQueryAdapter> =
  TAdapter extends TransactionalQueryAdapter<infer TTransactionAdapter>
    ? TTransactionAdapter
    : never

/** A transaction-capable streaming adapter whose scoped client can stream. */
export type StreamingTransactionalQueryAdapter = StreamingQueryAdapter &
  TransactionalQueryAdapter<StreamingQueryAdapter>

/** A query client with one application-owned adapter bound to every call. */
export interface QubuClient<TAdapter extends QueryAdapter = QueryAdapter> {
  /** The adapter supplied to {@link qubu}. */
  readonly adapter: TAdapter
  /** Execute a query and keep the adapter's structured mutation facts. */
  execute<TRow extends object>(
    query: QueryWithRow<TRow>,
    options?: ExecutionOptions,
  ): Promise<ExecutionResult<TRow>>
  /** Execute a query and return only its decoded rows. */
  rows<TRow extends object>(
    query: QueryWithRow<TRow>,
    options?: ExecutionOptions,
  ): Promise<readonly TRow[]>
}

/** A bound client whose adapter also decodes vendor-specific EXPLAIN rows. */
export interface QubuExplainableClient<
  TAdapter extends ExplainableQueryAdapter = ExplainableQueryAdapter,
> extends QubuClient<TAdapter> {
  /** Explain a query without executing it and return adapter-owned plan rows. */
  explain<TQuery extends AnyQuery>(
    query: TQuery,
    options?: ExplainOptionsFor<TQuery>,
  ): Promise<ExplainResult<ExplainPlanRow<TAdapter>>>
}

/** A bound client whose adapter also supports typed read-query streams. */
export interface QubuStreamingClient<
  TAdapter extends StreamingQueryAdapter = StreamingQueryAdapter,
> extends QubuClient<TAdapter> {
  /** Stream decoded rows without materializing the complete result. */
  stream<TRow extends object>(
    query: StreamableQuery<TRow>,
    options?: ExecutionOptions,
  ): AsyncIterable<TRow>
}

/** A bound client that supports both streaming and typed EXPLAIN plans. */
export interface QubuStreamingExplainableClient<
  TAdapter extends StreamingQueryAdapter & ExplainableQueryAdapter = StreamingQueryAdapter &
    ExplainableQueryAdapter,
>
  extends QubuStreamingClient<TAdapter>, QubuExplainableClient<TAdapter> {}

type QubuClientFor<TAdapter extends QueryAdapter> = TAdapter extends StreamingQueryAdapter
  ? TAdapter extends ExplainableQueryAdapter
    ? QubuStreamingExplainableClient<TAdapter>
    : QubuStreamingClient<TAdapter>
  : TAdapter extends ExplainableQueryAdapter
    ? QubuExplainableClient<TAdapter>
    : QubuClient<TAdapter>

/** The client available inside a transaction callback. */
export type QubuTransaction = QubuClient<QueryAdapter>

/** The streaming client available inside a streaming transaction callback. */
export type QubuStreamingTransaction = QubuStreamingClient<StreamingQueryAdapter>

/** A bound client whose adapter supports transaction-scoped execution. */
export interface QubuTransactionalClient<
  TAdapter extends TransactionalQueryAdapter = TransactionalQueryAdapter,
  TTransactionAdapter extends QueryAdapter = QueryAdapter,
> extends QubuClient<TAdapter> {
  /** Run several queries on one adapter-owned transaction. */
  transaction<T>(
    callback: (transaction: QubuClientFor<TTransactionAdapter>) => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T>
}

/** A bound EXPLAIN client with an adapter-owned transaction callback. */
export type QubuExplainableTransactionalClient<
  TAdapter extends ExplainableQueryAdapter & TransactionalQueryAdapter = ExplainableQueryAdapter &
    TransactionalQueryAdapter,
  TTransactionAdapter extends QueryAdapter = QueryAdapter,
> = QubuExplainableClient<TAdapter> & QubuTransactionalClient<TAdapter, TTransactionAdapter>

/** A bound streaming and EXPLAIN client with an adapter-owned transaction. */
export type QubuExplainableStreamingTransactionalClient<
  TAdapter extends ExplainableQueryAdapter & StreamingTransactionalQueryAdapter =
    ExplainableQueryAdapter & StreamingTransactionalQueryAdapter,
> = QubuStreamingExplainableClient<TAdapter> &
  QubuTransactionalClient<TAdapter, StreamingQueryAdapter>

/** A bound streaming client whose transaction callback can also stream. */
export interface QubuStreamingTransactionalClient<
  TAdapter extends StreamingTransactionalQueryAdapter = StreamingTransactionalQueryAdapter,
> extends QubuStreamingClient<TAdapter> {
  /** Run a callback whose streams must be consumed or closed before it resolves. */
  transaction<T>(
    callback: (transaction: QubuStreamingTransaction) => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T>
}

/** Bind an application-owned adapter once for repeated query execution. */
export function qubu<TAdapter extends ExplainableQueryAdapter & StreamingTransactionalQueryAdapter>(
  adapter: TAdapter,
): QubuExplainableStreamingTransactionalClient<TAdapter>
export function qubu<
  TAdapter extends ExplainableQueryAdapter & TransactionalQueryAdapter & StreamingQueryAdapter,
>(
  adapter: TAdapter,
): QubuExplainableTransactionalClient<TAdapter> & QubuStreamingExplainableClient<TAdapter>
export function qubu<TAdapter extends ExplainableQueryAdapter & TransactionalQueryAdapter>(
  adapter: TAdapter,
): QubuExplainableTransactionalClient<TAdapter, TransactionAdapterOf<TAdapter>>
export function qubu<TAdapter extends ExplainableQueryAdapter & StreamingQueryAdapter>(
  adapter: TAdapter,
): QubuStreamingExplainableClient<TAdapter>
export function qubu<TAdapter extends ExplainableQueryAdapter>(
  adapter: TAdapter,
): QubuExplainableClient<TAdapter>
export function qubu<TAdapter extends StreamingTransactionalQueryAdapter>(
  adapter: TAdapter,
): QubuStreamingTransactionalClient<TAdapter>
export function qubu<TAdapter extends TransactionalQueryAdapter & StreamingQueryAdapter>(
  adapter: TAdapter,
): QubuTransactionalClient<TAdapter> & QubuStreamingClient<TAdapter>
export function qubu<TAdapter extends TransactionalQueryAdapter>(
  adapter: TAdapter,
): QubuTransactionalClient<TAdapter, TransactionAdapterOf<TAdapter>>
export function qubu<TAdapter extends StreamingQueryAdapter>(
  adapter: TAdapter,
): QubuStreamingClient<TAdapter>
export function qubu<TAdapter extends QueryAdapter>(adapter: TAdapter): QubuClient<TAdapter>
export function qubu<TAdapter extends QueryAdapter>(adapter: TAdapter): QubuClient<TAdapter> {
  const client = createClient(adapter)

  if (!isTransactionalQueryAdapter(adapter)) {
    return client
  }

  return Object.freeze({
    ...client,
    transaction<T>(
      callback: (transaction: QubuTransaction) => Promise<T>,
      options?: TransactionOptions,
    ) {
      return adapter.transaction(
        async (transactionAdapter) => callback(createClient(transactionAdapter)),
        options,
      )
    },
  }) as QubuClient<TAdapter>
}

function createClient<TAdapter extends QueryAdapter>(adapter: TAdapter): QubuClient<TAdapter> {
  const client = {
    adapter,
    execute<TRow extends object>(query: QueryWithRow<TRow>, options?: ExecutionOptions) {
      return execute(query, adapter, options)
    },
    rows<TRow extends object>(query: QueryWithRow<TRow>, options?: ExecutionOptions) {
      return executeRows(query, adapter, options)
    },
  }
  const streaming = isStreamingQueryAdapter(adapter)
  const explainable = isExplainableQueryAdapter(adapter)

  if (!streaming && !explainable) {
    return Object.freeze(client)
  }

  return Object.freeze({
    ...client,
    ...(streaming
      ? {
          stream<TRow extends object>(query: StreamableQuery<TRow>, options?: ExecutionOptions) {
            return stream(query, adapter, options)
          },
        }
      : {}),
    ...(explainable
      ? {
          explain<TQuery extends AnyQuery>(query: TQuery, options?: ExplainOptionsFor<TQuery>) {
            return explain(query, adapter, options)
          },
        }
      : {}),
  }) as QubuClient<TAdapter>
}

function isTransactionalQueryAdapter(adapter: QueryAdapter): adapter is TransactionalQueryAdapter {
  return typeof (adapter as Partial<TransactionalQueryAdapter>).transaction === "function"
}

function isStreamingQueryAdapter(adapter: QueryAdapter): adapter is StreamingQueryAdapter {
  return typeof (adapter as Partial<StreamingQueryAdapter>).stream === "function"
}

function isExplainableQueryAdapter(adapter: QueryAdapter): adapter is ExplainableQueryAdapter {
  return typeof (adapter as Partial<ExplainableQueryAdapter>).explain === "function"
}

export interface DriverValueEncoder<TDriverValue = unknown> {
  /** Convert one Qubu parameter into the driver's bindable representation. */
  encode(value: unknown): TDriverValue
}

/**
 * Render a typed query, pass it to an application adapter, and return the adapter's structured
 * result unchanged.
 *
 * Driver errors are not caught or translated.
 */
export function execute<TRow extends object>(
  query: QueryWithRow<TRow>,
  adapter: QueryAdapter,
  options?: ExecutionOptions,
): Promise<ExecutionResult<TRow>>
export function execute<TRow extends object>(
  adapter: QueryAdapter,
  query: QueryWithRow<TRow>,
  options?: ExecutionOptions,
): Promise<ExecutionResult<TRow>>
export function execute<TRow extends object>(
  first: QueryWithRow<TRow> | QueryAdapter,
  second: QueryWithRow<TRow> | QueryAdapter,
  options: ExecutionOptions = {},
): Promise<ExecutionResult<TRow>> {
  return executeInternal(first, second, options)
}

/** Execute a query and return its decoded rows without mutation facts. */
export function executeRows<TRow extends object>(
  query: QueryWithRow<TRow>,
  adapter: QueryAdapter,
  options?: ExecutionOptions,
): Promise<readonly TRow[]>
export function executeRows<TRow extends object>(
  adapter: QueryAdapter,
  query: QueryWithRow<TRow>,
  options?: ExecutionOptions,
): Promise<readonly TRow[]>
export async function executeRows<TRow extends object>(
  first: QueryWithRow<TRow> | QueryAdapter,
  second: QueryWithRow<TRow> | QueryAdapter,
  options: ExecutionOptions = {},
): Promise<readonly TRow[]> {
  const result = await executeInternal(first, second, options)

  return result.rows
}

/**
 * Render a query as a dialect-specific EXPLAIN request and return the adapter-decoded vendor plan
 * rows. EXPLAIN never calls QueryAdapter.execute.
 */
export function explain<TQuery extends AnyQuery, TAdapter extends ExplainableQueryAdapter>(
  query: TQuery,
  adapter: TAdapter,
  options?: ExplainOptionsFor<TQuery>,
): Promise<ExplainResult<ExplainPlanRow<TAdapter>>>
export function explain<TQuery extends AnyQuery, TAdapter extends ExplainableQueryAdapter>(
  adapter: TAdapter,
  query: TQuery,
  options?: ExplainOptionsFor<TQuery>,
): Promise<ExplainResult<ExplainPlanRow<TAdapter>>>
export async function explain(
  first: AnyQuery | ExplainableQueryAdapter,
  second: AnyQuery | ExplainableQueryAdapter,
  options: ExplainOptions = {},
): Promise<ExplainResult<any>> {
  const query = (isQuery(first) ? first : second) as AnyQuery
  const adapter = (isQuery(first) ? second : first) as ExplainableQueryAdapter

  return adapter.explain(createExplainRequest(query, adapter, options))
}

/**
 * Render a SELECT or set-operation query and return the adapter-owned row stream. Mutations,
 * including mutations with RETURNING, must use execute().
 */
export function stream<TRow extends object>(
  query: StreamableQuery<TRow>,
  adapter: StreamingQueryAdapter,
  options?: ExecutionOptions,
): AsyncIterable<TRow>
export function stream<TRow extends object>(
  adapter: StreamingQueryAdapter,
  query: StreamableQuery<TRow>,
  options?: ExecutionOptions,
): AsyncIterable<TRow>
export function stream<TRow extends object>(
  first: StreamableQuery<TRow> | StreamingQueryAdapter,
  second: StreamableQuery<TRow> | StreamingQueryAdapter,
  options: ExecutionOptions = {},
): AsyncIterable<TRow> {
  const query = (isQuery(first) ? first : second) as StreamableQuery<TRow>
  const adapter = (isQuery(first) ? second : first) as StreamingQueryAdapter

  assertStreamableQuery(query)
  const request = createExecutionRequest(query, adapter, options)
  const dialect = options.dialect ?? adapter.dialect

  return decodeResultStream<TRow>(adapter.stream(request), request, adapter, dialect)
}

async function executeInternal<TRow extends object>(
  first: QueryWithRow<TRow> | QueryAdapter,
  second: QueryWithRow<TRow> | QueryAdapter,
  options: ExecutionOptions,
): Promise<ExecutionResult<TRow>> {
  const query = isQuery(first) ? first : (second as QueryWithRow<TRow>)
  const adapter = isQuery(first) ? (second as QueryAdapter) : (first as QueryAdapter)
  const request = createExecutionRequest(query, adapter, options)

  // Deliberately do not catch or wrap driver errors. Adapters own their
  // driver's error type and transaction/connection lifecycle.
  const result = await adapter.execute(request)
  const dialect = options.dialect ?? adapter.dialect

  return {
    ...result,
    rows: result.rows.map((row, rowIndex) =>
      decodeResultRow<TRow>(row, request.resultShape, adapter.decoders, dialect, rowIndex),
    ),
  }
}

function createExecutionRequest(
  query: AnyQuery,
  adapter: QueryAdapter,
  options: ExecutionOptions,
): ExecutionRequest {
  const statement = render(query, {
    dialect: options.dialect ?? adapter.dialect,
  })

  return Object.freeze({
    statement,
    queryKind: query.queryKind,
    resultShape: query.resultShape,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
}

async function* decodeResultStream<TRow extends object>(
  rows: AsyncIterable<Readonly<Record<string, unknown>>>,
  request: ExecutionRequest,
  adapter: StreamingQueryAdapter,
  dialect: Dialect,
): AsyncIterable<TRow> {
  let rowIndex = 0

  for await (const row of rows) {
    yield decodeResultRow<TRow>(row, request.resultShape, adapter.decoders, dialect, rowIndex++)
  }
}

function createExplainRequest(
  query: AnyQuery,
  adapter: ExplainableQueryAdapter,
  options: ExplainOptions,
): ExplainRequest {
  const request = createExecutionRequest(query, adapter, options)

  if (options.analyze === true && query.queryKind !== "select" && query.queryKind !== "set") {
    throw queryValidationError({
      code: "invalid-explain-query",
      context: "execution.explain",
      path: ["analyze"],
      message: `EXPLAIN ANALYZE is only available for read queries; received ${query.queryKind}`,
      hint: "Remove analyze for a plan-only mutation EXPLAIN.",
    })
  }

  const dialect = options.dialect ?? adapter.dialect

  if (dialect.explain === undefined) {
    throw queryValidationError({
      code: "unsupported-explain-dialect",
      context: "execution.explain",
      path: ["dialect"],
      message: `Dialect "${dialect.name}" does not provide an EXPLAIN rendering policy`,
      hint: "Use PostgreSQL, SQLite, MySQL, or a custom dialect with an explain policy.",
    })
  }

  const statement = Object.freeze({
    text: dialect.explain.render(request.statement.text, query.queryKind, options),
    parameters: request.statement.parameters,
  })

  return Object.freeze({
    ...request,
    statement,
  })
}

function assertStreamableQuery(query: AnyQuery): asserts query is StreamableQuery<any> {
  if (query.queryKind === "select" || query.queryKind === "set") {
    return
  }

  throw queryValidationError({
    code: "invalid-stream-query",
    context: "execution.stream",
    path: ["queryKind"],
    message: `Only SELECT and set-operation queries can be streamed; received ${query.queryKind}`,
    hint: "Use execute() or executeRows() for mutation queries.",
  })
}

function isQuery(value: AnyQuery | QueryAdapter): value is AnyQuery {
  return "render" in value && typeof value.render === "function"
}
