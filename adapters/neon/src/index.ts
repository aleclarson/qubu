import type {
  FullQueryResults,
  HTTPQueryOptions,
  NeonQueryFunction,
} from "@neondatabase/serverless"
import type {
  DriverValueEncoder,
  ExecutionRequest,
  ExecutionResult,
  ExplainableQueryAdapter,
  ExplainResult,
} from "qubu"
import { postgresDialect } from "qubu/postgres"

/** The query surface used by Neon's HTTP mode. */
export type NeonHttpClient = Pick<NeonQueryFunction<false, false>, "query">

export interface NeonAdapterOptions {
  /** Convert Qubu values before the Neon client serializes them. */
  readonly encoder?: DriverValueEncoder
  /** Static Neon HTTP options; `fullResults` and `arrayMode` are adapter-owned. */
  readonly queryOptions?: Omit<HTTPQueryOptions<false, true>, "arrayMode" | "fullResults">
}

export type NeonRow = Record<string, unknown>

export interface NeonAdapter extends ExplainableQueryAdapter<NeonRow> {
  readonly client: NeonHttpClient
}

const identityEncoder: DriverValueEncoder = { encode: (value) => value }

type NeonQueryResult = FullQueryResults<false> | readonly NeonRow[]

/** Adapt one `neon()` HTTP query function for Qubu execution. */
export function neonAdapter(client: NeonHttpClient, options: NeonAdapterOptions = {}): NeonAdapter {
  const encoder = options.encoder ?? identityEncoder

  return {
    client,
    dialect: postgresDialect(),
    execute<TRow extends object>(request: ExecutionRequest) {
      return executeRequest<TRow>(client, request, options, encoder)
    },
    async explain(request) {
      const result = await executeRequest<NeonRow>(client, request, options, encoder)

      return { rows: result.rows } satisfies ExplainResult<NeonRow>
    },
  }
}

/** Alias that makes the HTTP transport explicit at call sites. */
export const neonHttpAdapter = neonAdapter

async function executeRequest<TRow extends object>(
  client: NeonHttpClient,
  request: ExecutionRequest,
  options: NeonAdapterOptions,
  encoder: DriverValueEncoder,
): Promise<ExecutionResult<TRow>> {
  throwIfAborted(request.signal)

  const result = (await client.query<false, true>(
    request.statement.text,
    request.statement.parameters.map((value) => encoder.encode(value)),
    queryOptions(options, request.signal),
  )) as NeonQueryResult
  let rows: readonly NeonRow[]
  let rowCount: number | undefined

  if (isNeonRows(result)) {
    rows = result
  } else {
    rows = result.rows
    rowCount = typeof result.rowCount === "number" ? result.rowCount : undefined
  }

  const isMutation = request.queryKind !== "select" && request.queryKind !== "set"

  return {
    rows: rows as readonly TRow[],
    ...(isMutation && rowCount !== undefined ? { affectedRows: rowCount } : {}),
  } satisfies ExecutionResult<TRow>
}

function isNeonRows(result: NeonQueryResult): result is readonly NeonRow[] {
  return Array.isArray(result)
}

function queryOptions(
  options: NeonAdapterOptions,
  signal: AbortSignal | undefined,
): HTTPQueryOptions<false, true> {
  const configuredFetchOptions = options.queryOptions?.fetchOptions
  const fetchOptions =
    signal === undefined
      ? configuredFetchOptions
      : {
          ...configuredFetchOptions,
          signal,
        }
  const queryOptions: HTTPQueryOptions<false, true> = {
    ...options.queryOptions,
    arrayMode: false,
    fullResults: true,
  }

  if (fetchOptions !== undefined) {
    queryOptions.fetchOptions = fetchOptions
  }

  return queryOptions
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  signal?.throwIfAborted()
}
