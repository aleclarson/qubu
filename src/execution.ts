import type { Dialect, ExplainRenderOptions } from "./core/dialect.ts"
import { render, type RenderedQuery, type RenderOptions } from "./core/render.ts"
import type { SqlTypeName } from "./core/sql-types.ts"
import { queryValidationError } from "./query/errors.ts"
import type { AnyQuery, QueryKind, QueryWithRow } from "./query/types.ts"
import { decodeResultRow, type ResultDecoders, type ResultShape } from "./result.ts"

export type StreamableQuery<TRow extends object = Record<string, unknown>> = QueryWithRow<TRow> & {
  readonly queryKind: "select" | "set"
}

/** Scalar application metadata forwarded only to bound-client lifecycle hooks. */
export type HookMetadataValue = string | number | boolean

/** Application correlation metadata forwarded without affecting execution. */
export type HookMetadata = Readonly<Record<string, HookMetadataValue>>

/** Rendering policy and cancellation input accepted by query execution. */
export interface ExecutionOptions extends RenderOptions {
  /** Passed to the application adapter for drivers that support cancellation. */
  readonly signal?: AbortSignal
  /** Inert application metadata exposed to bound-client hooks. */
  readonly hookMetadata?: HookMetadata
}

/** Rendering, EXPLAIN, and cancellation options for plan requests. */
export interface ExplainOptions extends RenderOptions, ExplainRenderOptions {
  /** Passed to the application adapter for drivers that support cancellation. */
  readonly signal?: AbortSignal
  /** Inert application metadata exposed to bound-client hooks. */
  readonly hookMetadata?: HookMetadata
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
  /** Inert application metadata exposed to bound-client hooks. */
  readonly hookMetadata?: HookMetadata
}

/** Operations observable through one bound client's hooks. */
export type HookOperationKind = "execute" | "stream" | "explain" | "transaction"

interface HookOperationBase {
  /** Opaque identifier unique within one bound client and its transaction scopes. */
  readonly id: number
  /** The enclosing transaction operation, when present. */
  readonly parentId?: number
  readonly kind: HookOperationKind
  /** Monotonic start time in milliseconds. */
  readonly startedAt: number
  readonly metadata?: HookMetadata
}

/** Metadata for one bound-client query operation. */
export interface HookQueryOperation extends HookOperationBase {
  readonly kind: "execute" | "stream" | "explain"
  readonly queryKind: QueryKind
  readonly dialect: string
  readonly sql: string
  readonly parameterCount: number
}

/** Metadata for one bound-client transaction operation. */
export interface HookTransactionOperation extends HookOperationBase {
  readonly kind: "transaction"
}

/** Immutable metadata supplied when a bound-client operation starts. */
export type HookOperation = HookQueryOperation | HookTransactionOperation

/** How a successfully observed stream stopped producing rows. */
export type HookStreamEnd = "complete" | "consumer-return"

/** Aggregate facts reported after a successful bound-client operation. */
export interface HookSuccessOutcome {
  readonly status: "success"
  readonly durationMs: number
  readonly rowCount?: number
  readonly affectedRows?: number | bigint
  readonly changedRows?: number | bigint
  readonly hasInsertId?: boolean
  readonly streamEnd?: HookStreamEnd
}

/** The original failure reported after a bound-client operation rejects or throws. */
export interface HookErrorOutcome {
  readonly status: "error"
  readonly durationMs: number
  readonly error: unknown
}

/** Terminal observation for one bound-client operation. */
export type HookOutcome = HookSuccessOutcome | HookErrorOutcome

/** Optional completion callback returned when an operation starts. */
export type OperationEndHook = (outcome: HookOutcome) => void

/** Observational callbacks for one bound client and its transaction scopes. */
export interface QubuHooks {
  onOperationStart?(operation: HookOperation): OperationEndHook | void
  /** Receives hook failures without changing the observed operation's outcome. */
  onHookError?(error: unknown): void
}

/** Optional lifecycle observation configured for one bound client. */
export interface QubuOptions {
  readonly hooks?: QubuHooks
}

/** One rendered statement, runtime parameter domains, and controls passed to an application adapter. */
export interface ExecutionRequest {
  /** SQL text, raw application parameters, and optional domain sidecar produced by Qubu's renderer. */
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
 * placeholder order, and `request.statement.parameterSqlTypes` optionally contains their aligned
 * SQL domains. The adapter binds and encodes them for its driver. Connection pooling, transactions,
 * retries, and proprietary driver-row normalization remain adapter concerns. Qubu applies the
 * adapter's registered logical result decoders afterward.
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

/** Opt-in recursive transaction scopes; adapters own savepoints and scope lifetime. */
export interface NestedTransactionalQueryAdapter<
  TBase extends QueryAdapter = QueryAdapter,
> extends TransactionalQueryAdapter<TBase & NestedTransactionalQueryAdapter<TBase>> {}

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

type QubuBaseClientFor<TAdapter extends QueryAdapter> = TAdapter extends StreamingQueryAdapter
  ? TAdapter extends ExplainableQueryAdapter
    ? QubuStreamingExplainableClient<TAdapter>
    : QubuStreamingClient<TAdapter>
  : TAdapter extends ExplainableQueryAdapter
    ? QubuExplainableClient<TAdapter>
    : QubuClient<TAdapter>

type QubuClientFor<TAdapter extends QueryAdapter> = QubuBaseClientFor<TAdapter> &
  (TAdapter extends TransactionalQueryAdapter
    ? QubuTransactionalClient<TAdapter, TransactionAdapterOf<TAdapter>>
    : {})

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

interface HookObservation {
  readonly hooks: QubuHooks
  nextOperationId: number
}

type HookCompletion =
  | {
      readonly status: "success"
      readonly rowCount?: number
      readonly affectedRows?: number | bigint
      readonly changedRows?: number | bigint
      readonly hasInsertId?: boolean
      readonly streamEnd?: HookStreamEnd
    }
  | {
      readonly status: "error"
      readonly error: unknown
    }

interface ActiveHookOperation {
  readonly operation: HookOperation
  finish(completion: HookCompletion): void
}

/** Bind an application-owned adapter once for repeated query execution. */
export function qubu<TAdapter extends NestedTransactionalQueryAdapter>(
  adapter: TAdapter,
  options?: QubuOptions,
): QubuClientFor<TAdapter>
export function qubu<TAdapter extends ExplainableQueryAdapter & StreamingTransactionalQueryAdapter>(
  adapter: TAdapter,
  options?: QubuOptions,
): QubuExplainableStreamingTransactionalClient<TAdapter>
export function qubu<
  TAdapter extends ExplainableQueryAdapter & TransactionalQueryAdapter & StreamingQueryAdapter,
>(
  adapter: TAdapter,
  options?: QubuOptions,
): QubuExplainableTransactionalClient<TAdapter> & QubuStreamingExplainableClient<TAdapter>
export function qubu<TAdapter extends ExplainableQueryAdapter & TransactionalQueryAdapter>(
  adapter: TAdapter,
  options?: QubuOptions,
): QubuExplainableTransactionalClient<TAdapter, TransactionAdapterOf<TAdapter>>
export function qubu<TAdapter extends ExplainableQueryAdapter & StreamingQueryAdapter>(
  adapter: TAdapter,
  options?: QubuOptions,
): QubuStreamingExplainableClient<TAdapter>
export function qubu<TAdapter extends ExplainableQueryAdapter>(
  adapter: TAdapter,
  options?: QubuOptions,
): QubuExplainableClient<TAdapter>
export function qubu<TAdapter extends StreamingTransactionalQueryAdapter>(
  adapter: TAdapter,
  options?: QubuOptions,
): QubuStreamingTransactionalClient<TAdapter>
export function qubu<TAdapter extends TransactionalQueryAdapter & StreamingQueryAdapter>(
  adapter: TAdapter,
  options?: QubuOptions,
): QubuTransactionalClient<TAdapter> & QubuStreamingClient<TAdapter>
export function qubu<TAdapter extends TransactionalQueryAdapter>(
  adapter: TAdapter,
  options?: QubuOptions,
): QubuTransactionalClient<TAdapter, TransactionAdapterOf<TAdapter>>
export function qubu<TAdapter extends StreamingQueryAdapter>(
  adapter: TAdapter,
  options?: QubuOptions,
): QubuStreamingClient<TAdapter>
export function qubu<TAdapter extends QueryAdapter>(
  adapter: TAdapter,
  options?: QubuOptions,
): QubuClient<TAdapter>
export function qubu<TAdapter extends QueryAdapter>(
  adapter: TAdapter,
  options: QubuOptions = {},
): QubuClient<TAdapter> {
  return createClient(adapter, createObservation(options.hooks))
}

function createClient<TAdapter extends QueryAdapter>(
  adapter: TAdapter,
  observation?: HookObservation,
  parentId?: number,
): QubuClient<TAdapter> {
  return Object.freeze({
    adapter,
    execute<TRow extends object>(query: QueryWithRow<TRow>, options?: ExecutionOptions) {
      return executeInternal(query, adapter, options ?? {}, observation, parentId)
    },
    rows<TRow extends object>(query: QueryWithRow<TRow>, options?: ExecutionOptions) {
      return executeRowsInternal(query, adapter, options ?? {}, observation, parentId)
    },
    ...(isStreamingQueryAdapter(adapter)
      ? {
          stream<TRow extends object>(query: StreamableQuery<TRow>, options?: ExecutionOptions) {
            return streamInternal(query, adapter, options ?? {}, observation, parentId)
          },
        }
      : {}),
    ...(isExplainableQueryAdapter(adapter)
      ? {
          explain<TQuery extends AnyQuery>(query: TQuery, options?: ExplainOptionsFor<TQuery>) {
            return explainInternal(query, adapter, options ?? {}, observation, parentId)
          },
        }
      : {}),
    ...(isTransactionalQueryAdapter(adapter)
      ? {
          async transaction<T>(
            callback: (transaction: QubuTransaction) => Promise<T>,
            options?: TransactionOptions,
          ) {
            const active = startTransactionOperation(observation, options?.hookMetadata, parentId)

            try {
              const result = await adapter.transaction(
                async (scoped) => callback(createClient(scoped, observation, active?.operation.id)),
                adapterTransactionOptions(options),
              )

              active?.finish({ status: "success" })
              return result
            } catch (error) {
              active?.finish({
                status: "error",
                error,
              })
              throw error
            }
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

function createObservation(hooks: QubuHooks | undefined): HookObservation | undefined {
  if (hooks === undefined) {
    return undefined
  }

  return {
    hooks: Object.freeze({ ...hooks }),
    nextOperationId: 1,
  }
}

function startQueryOperation(
  observation: HookObservation | undefined,
  kind: HookQueryOperation["kind"],
  request: ExecutionRequest,
  dialect: Dialect,
  metadata: HookMetadata | undefined,
  parentId: number | undefined,
): ActiveHookOperation | undefined {
  return startOperation(observation, {
    kind,
    queryKind: request.queryKind,
    dialect: dialect.name,
    sql: request.statement.text,
    parameterCount: request.statement.parameters.length,
    metadata,
    parentId,
  })
}

function startTransactionOperation(
  observation: HookObservation | undefined,
  metadata: HookMetadata | undefined,
  parentId?: number,
): ActiveHookOperation | undefined {
  return startOperation(observation, {
    kind: "transaction",
    metadata,
    parentId,
  })
}

function startOperation(
  observation: HookObservation | undefined,
  input:
    | {
        readonly kind: HookQueryOperation["kind"]
        readonly queryKind: QueryKind
        readonly dialect: string
        readonly sql: string
        readonly parameterCount: number
        readonly metadata: HookMetadata | undefined
        readonly parentId: number | undefined
      }
    | {
        readonly kind: "transaction"
        readonly metadata: HookMetadata | undefined
        readonly parentId: number | undefined
      },
): ActiveHookOperation | undefined {
  if (observation === undefined) {
    return undefined
  }

  const startedAt = monotonicTime()
  const operation = Object.freeze({
    id: observation.nextOperationId++,
    ...(input.parentId === undefined ? {} : { parentId: input.parentId }),
    kind: input.kind,
    startedAt,
    ...(input.metadata === undefined ? {} : { metadata: freezeMetadata(input.metadata) }),
    ...(input.kind === "transaction"
      ? {}
      : {
          queryKind: input.queryKind,
          dialect: input.dialect,
          sql: input.sql,
          parameterCount: input.parameterCount,
        }),
  }) as HookOperation
  let endHook: OperationEndHook | undefined

  try {
    endHook = observation.hooks.onOperationStart?.(operation) ?? undefined
  } catch (error) {
    reportHookError(observation.hooks, error)
  }

  let finished = false

  return {
    operation,
    finish(completion) {
      if (finished) {
        return
      }

      finished = true
      if (endHook === undefined) {
        return
      }

      const outcome = Object.freeze({
        ...completion,
        durationMs: monotonicTime() - startedAt,
      }) as HookOutcome

      try {
        endHook(outcome)
      } catch (error) {
        reportHookError(observation.hooks, error)
      }
    },
  }
}

function reportHookError(hooks: QubuHooks, error: unknown): void {
  try {
    hooks.onHookError?.(error)
  } catch {
    // Hook error reporting is observational and must not affect execution.
  }
}

function freezeMetadata(metadata: HookMetadata): HookMetadata {
  return Object.freeze({ ...metadata })
}

function monotonicTime(): number {
  return performance.now()
}

function adapterTransactionOptions(
  options: TransactionOptions | undefined,
): TransactionOptions | undefined {
  if (options?.hookMetadata === undefined) {
    return options
  }

  const { hookMetadata: _hookMetadata, ...adapterOptions } = options

  return adapterOptions
}

export interface DriverValueEncoder<TDriverValue = unknown> {
  /**
   * Convert one Qubu parameter into the driver's bindable representation and receive its SQL
   * domain.
   */
  encode(value: unknown, sqlType?: SqlTypeName): TDriverValue
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
  return executeRowsInternal(first, second, options)
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

  return explainInternal(query, adapter, options)
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

  return streamInternal(query, adapter, options)
}

async function executeInternal<TRow extends object>(
  first: QueryWithRow<TRow> | QueryAdapter,
  second: QueryWithRow<TRow> | QueryAdapter,
  options: ExecutionOptions,
  observation?: HookObservation,
  parentId?: number,
): Promise<ExecutionResult<TRow>> {
  const query = isQuery(first) ? first : (second as QueryWithRow<TRow>)
  const adapter = isQuery(first) ? (second as QueryAdapter) : (first as QueryAdapter)
  const request = createExecutionRequest(query, adapter, options)
  const dialect = options.dialect ?? adapter.dialect
  const active = startQueryOperation(
    observation,
    "execute",
    request,
    dialect,
    options.hookMetadata,
    parentId,
  )

  try {
    // Deliberately do not wrap driver errors. Adapters own their driver's
    // error type and transaction/connection lifecycle.
    const result = await adapter.execute(request)
    const decoded = {
      ...result,
      rows: result.rows.map((row, rowIndex) =>
        decodeResultRow<TRow>(row, request.resultShape, adapter.decoders, dialect, rowIndex),
      ),
    }

    active?.finish({
      status: "success",
      rowCount: decoded.rows.length,
      ...(decoded.affectedRows === undefined ? {} : { affectedRows: decoded.affectedRows }),
      ...(decoded.changedRows === undefined ? {} : { changedRows: decoded.changedRows }),
      ...(decoded.insertId === undefined ? {} : { hasInsertId: true }),
    })
    return decoded
  } catch (error) {
    active?.finish({
      status: "error",
      error,
    })
    throw error
  }
}

async function executeRowsInternal<TRow extends object>(
  first: QueryWithRow<TRow> | QueryAdapter,
  second: QueryWithRow<TRow> | QueryAdapter,
  options: ExecutionOptions,
  observation?: HookObservation,
  parentId?: number,
): Promise<readonly TRow[]> {
  const result = await executeInternal(first, second, options, observation, parentId)

  return result.rows
}

async function explainInternal(
  query: AnyQuery,
  adapter: ExplainableQueryAdapter,
  options: ExplainOptions,
  observation?: HookObservation,
  parentId?: number,
): Promise<ExplainResult<any>> {
  const request = createExplainRequest(query, adapter, options)
  const dialect = options.dialect ?? adapter.dialect
  const active = startQueryOperation(
    observation,
    "explain",
    request,
    dialect,
    options.hookMetadata,
    parentId,
  )

  try {
    const result = await adapter.explain(request)

    active?.finish({
      status: "success",
      rowCount: result.rows.length,
    })
    return result
  } catch (error) {
    active?.finish({
      status: "error",
      error,
    })
    throw error
  }
}

function streamInternal<TRow extends object>(
  query: StreamableQuery<TRow>,
  adapter: StreamingQueryAdapter,
  options: ExecutionOptions,
  observation?: HookObservation,
  parentId?: number,
): AsyncIterable<TRow> {
  assertStreamableQuery(query)
  const request = createExecutionRequest(query, adapter, options)
  const dialect = options.dialect ?? adapter.dialect
  const active = startQueryOperation(
    observation,
    "stream",
    request,
    dialect,
    options.hookMetadata,
    parentId,
  )

  try {
    return decodeResultStream<TRow>(adapter.stream(request), request, adapter, dialect, active)
  } catch (error) {
    active?.finish({
      status: "error",
      error,
    })
    throw error
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
  active?: ActiveHookOperation,
): AsyncIterable<TRow> {
  let rowIndex = 0
  let completed = false
  let failed = false

  try {
    for await (const row of rows) {
      yield decodeResultRow<TRow>(row, request.resultShape, adapter.decoders, dialect, rowIndex++)
    }

    completed = true
    active?.finish({
      status: "success",
      rowCount: rowIndex,
      streamEnd: "complete",
    })
  } catch (error) {
    failed = true
    active?.finish({
      status: "error",
      error,
    })
    throw error
  } finally {
    if (!completed && !failed) {
      active?.finish({
        status: "success",
        rowCount: rowIndex,
        streamEnd: "consumer-return",
      })
    }
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
    text: dialect.explain.render(
      request.statement.text,
      query.queryKind,
      explainRenderOptions(options),
    ),
    parameters: request.statement.parameters,
    ...(request.statement.parameterSqlTypes === undefined
      ? {}
      : { parameterSqlTypes: request.statement.parameterSqlTypes }),
  })

  return Object.freeze({
    ...request,
    statement,
  })
}

function explainRenderOptions(options: ExplainOptions): ExplainOptions {
  if (options.hookMetadata === undefined) {
    return options
  }

  const { hookMetadata: _hookMetadata, ...renderOptions } = options

  return renderOptions
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
