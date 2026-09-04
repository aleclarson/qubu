import {
  BeginTransactionCommand,
  CommitTransactionCommand,
  ExecuteStatementCommand,
  RollbackTransactionCommand,
  type ArrayValue,
  type BeginTransactionCommandOutput,
  type ColumnMetadata,
  type CommitTransactionCommandOutput,
  type ExecuteStatementCommandInput,
  type ExecuteStatementCommandOutput,
  type Field,
  type RDSDataClient,
  type ResultSetOptions,
  type RollbackTransactionCommandOutput,
} from "@aws-sdk/client-rds-data"
import { dateResultDecoder, jsonTextResultDecoder, timestampResultDecoder } from "qubu"
import type {
  DriverValueEncoder,
  ExecutionRequest,
  ExecutionResult,
  ExplainableQueryAdapter,
  ExplainRequest,
  ExplainResult,
  TransactionOptions,
  TransactionalQueryAdapter,
} from "qubu"
import type { Dialect, SqlTypeName } from "qubu/core"
import { mysqlDialect } from "qubu/mysql"
import { postgresDialect } from "qubu/postgres"

export type RdsDataApiEngine = "postgresql" | "mysql"

/** The AWS command instances used by the adapter's small fake-client boundary. */
export type RdsDataApiCommand =
  | InstanceType<typeof BeginTransactionCommand>
  | InstanceType<typeof CommitTransactionCommand>
  | InstanceType<typeof ExecuteStatementCommand>
  | InstanceType<typeof RollbackTransactionCommand>

export interface RdsDataApiSendOptions {
  readonly abortSignal?: AbortSignal
}

export type RdsDataApiResponse =
  | BeginTransactionCommandOutput
  | CommitTransactionCommandOutput
  | ExecuteStatementCommandOutput
  | RollbackTransactionCommandOutput
  | Record<string, unknown>

/** Minimal command sender used by deterministic tests and provider wrappers. */
export interface RdsDataApiClientStub {
  send(command: RdsDataApiCommand, options?: RdsDataApiSendOptions): Promise<RdsDataApiResponse>
}

/** A real AWS `RDSDataClient` or a structurally compatible command sender. */
export type RdsDataApiClient = Pick<RDSDataClient, "send"> | RdsDataApiClientStub

/** Options shared by the PostgreSQL and MySQL entry points. */
export interface RdsDataApiAdapterOptions {
  readonly resourceArn: string
  readonly secretArn: string
  readonly database?: string
  readonly schema?: string
  /** Convert Qubu values before they become AWS Data API fields. */
  readonly encoder?: DriverValueEncoder
  readonly continueAfterTimeout?: boolean
  readonly resultSetOptions?: ResultSetOptions
}

export interface RdsDataApiTransactionAdapter extends ExplainableQueryAdapter<
  Record<string, unknown>
> {}

export interface RdsDataApiAdapter<TEngine extends RdsDataApiEngine = RdsDataApiEngine>
  extends
    ExplainableQueryAdapter<Record<string, unknown>>,
    TransactionalQueryAdapter<RdsDataApiTransactionAdapter> {
  readonly client: RdsDataApiClient
  readonly engine: TEngine
}

const identityEncoder: DriverValueEncoder = { encode: (value) => value }

const rdsDataApiDecoders = Object.freeze({
  date: dateResultDecoder,
  timestamp: timestampResultDecoder,
  json: jsonTextResultDecoder,
})

/** Create the named-placeholder dialect required by Aurora's Data API. */
export function createRdsDataApiDialect(engine: "postgresql"): ReturnType<typeof postgresDialect>
export function createRdsDataApiDialect(engine: "mysql"): ReturnType<typeof mysqlDialect>
export function createRdsDataApiDialect(engine: RdsDataApiEngine): Dialect
export function createRdsDataApiDialect(engine: RdsDataApiEngine): Dialect {
  return withNamedPlaceholders(engine === "postgresql" ? postgresDialect() : mysqlDialect())
}

function withNamedPlaceholders<TDialect extends Dialect>(dialect: TDialect): TDialect {
  return Object.freeze({
    ...dialect,
    placeholder: (position: number) => `:p${position}`,
  }) as TDialect
}

/** Adapt one Aurora dialect through the AWS RDS Data API. */
export function createRdsDataApiAdapter<TEngine extends RdsDataApiEngine>(
  client: RdsDataApiClient,
  engine: TEngine,
  options: RdsDataApiAdapterOptions,
): RdsDataApiAdapter<TEngine> {
  const encoder = options.encoder ?? identityEncoder
  const scoped = executionAdapter(client, engine, options, encoder)

  return {
    ...scoped,
    client,
    engine,
    async transaction<T>(
      callback: (adapter: RdsDataApiTransactionAdapter) => Promise<T>,
      transactionOptions: TransactionOptions = {},
    ): Promise<T> {
      throwIfAborted(transactionOptions.signal)
      assertStatementSchemaSupported(options)
      const begin = await sendCommand<BeginTransactionCommandOutput>(
        client,
        new BeginTransactionCommand(transactionInput(options)),
        transactionOptions.signal,
      )
      const transactionId = begin.transactionId

      if (!transactionId) {
        throw new Error("AWS RDS Data API did not return a transaction ID")
      }

      try {
        throwIfAborted(transactionOptions.signal)
        const result = await callback(
          executionAdapter(client, engine, options, encoder, transactionId),
        )

        throwIfAborted(transactionOptions.signal)
        await sendCommand<CommitTransactionCommandOutput>(
          client,
          new CommitTransactionCommand(transactionEndInput(options, transactionId)),
          transactionOptions.signal,
        )
        return result
      } catch (error) {
        try {
          await sendCommand<RollbackTransactionCommandOutput>(
            client,
            new RollbackTransactionCommand(transactionEndInput(options, transactionId)),
          )
        } catch {
          // Preserve the callback or commit failure; the transaction is still provider-owned.
        }

        throw error
      }
    },
  }
}

function executionAdapter(
  client: RdsDataApiClient,
  engine: RdsDataApiEngine,
  options: RdsDataApiAdapterOptions,
  encoder: DriverValueEncoder,
  transactionId?: string,
): RdsDataApiTransactionAdapter {
  return {
    dialect: createRdsDataApiDialect(engine),
    decoders: rdsDataApiDecoders,
    async execute<TRow extends object>(request: ExecutionRequest) {
      return executeRequest<TRow>(client, options, encoder, request, transactionId)
    },
    async explain(request: ExplainRequest) {
      const result = await executeRequest<Record<string, unknown>>(
        client,
        options,
        encoder,
        request,
        transactionId,
      )

      return { rows: result.rows } satisfies ExplainResult<Record<string, unknown>>
    },
  }
}

async function executeRequest<TRow extends object>(
  client: RdsDataApiClient,
  options: RdsDataApiAdapterOptions,
  encoder: DriverValueEncoder,
  request: ExecutionRequest,
  transactionId?: string,
): Promise<ExecutionResult<TRow>> {
  throwIfAborted(request.signal)
  assertStatementSchemaSupported(options)
  const response = await sendCommand<ExecuteStatementCommandOutput>(
    client,
    new ExecuteStatementCommand(statementInput(options, encoder, request, transactionId)),
    request.signal,
  )
  const rows = normalizeRows(response)
  const isMutation = request.queryKind !== "select" && request.queryKind !== "set"
  const insertId =
    request.queryKind === "insert" ? generatedInsertId(response.generatedFields) : undefined

  return {
    rows: rows as readonly TRow[],
    ...(isMutation && response.numberOfRecordsUpdated !== undefined
      ? { affectedRows: response.numberOfRecordsUpdated }
      : {}),
    ...(insertId === undefined ? {} : { insertId }),
  } satisfies ExecutionResult<TRow>
}

function assertStatementSchemaSupported(options: RdsDataApiAdapterOptions): void {
  if (options.schema !== undefined) {
    throw new Error(
      "AWS RDS Data API does not support the schema parameter; qualify schema identifiers in SQL",
    )
  }
}

function statementInput(
  options: RdsDataApiAdapterOptions,
  encoder: DriverValueEncoder,
  request: ExecutionRequest,
  transactionId: string | undefined,
): ExecuteStatementCommandInput {
  return {
    resourceArn: options.resourceArn,
    secretArn: options.secretArn,
    sql: request.statement.text,
    parameters: request.statement.parameters.map((value, index) => ({
      ...encodeRdsDataApiParameter(
        `p${index + 1}`,
        encoder.encode(value, request.statement.parameterSqlTypes?.[index]),
        request.statement.parameterSqlTypes?.[index],
      ),
    })),
    includeResultMetadata: true,
    formatRecordsAs: "NONE",
    ...(options.database === undefined ? {} : { database: options.database }),
    ...(options.continueAfterTimeout === undefined
      ? {}
      : { continueAfterTimeout: options.continueAfterTimeout }),
    resultSetOptions: {
      decimalReturnType: "STRING",
      longReturnType: "STRING",
      ...options.resultSetOptions,
    } satisfies ResultSetOptions,
    ...(transactionId === undefined ? {} : { transactionId }),
  }
}

function transactionInput(options: RdsDataApiAdapterOptions) {
  return {
    resourceArn: options.resourceArn,
    secretArn: options.secretArn,
    ...(options.database === undefined ? {} : { database: options.database }),
  }
}

function transactionEndInput(options: RdsDataApiAdapterOptions, transactionId: string) {
  return {
    resourceArn: options.resourceArn,
    secretArn: options.secretArn,
    transactionId,
  }
}

/** Encode one JavaScript value as an AWS RDS Data API `Field`. */
export function encodeRdsDataApiValue(value: unknown, sqlType?: SqlTypeName): Field {
  if (value === null || value === undefined) {
    return { isNull: true }
  }

  if (typeof value === "boolean") {
    return { booleanValue: value }
  }

  if (typeof value === "string") {
    return { stringValue: value }
  }

  if (typeof value === "bigint") {
    return { stringValue: value.toString() }
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("RDS Data API parameters must contain finite numbers")
    }

    if (Number.isInteger(value)) {
      if (!Number.isSafeInteger(value)) {
        throw new TypeError(
          "RDS Data API parameters cannot contain unsafe integer numbers; use a bigint or string",
        )
      }

      if (sqlType !== "decimal") {
        return { longValue: value }
      }
    }

    if (sqlType === "decimal") {
      return { stringValue: String(value) }
    }

    return { doubleValue: value }
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new TypeError("RDS Data API parameters must contain valid dates")
    }

    return {
      stringValue:
        sqlType === "date"
          ? value.toISOString().slice(0, 10)
          : value.toISOString().slice(0, -1).replace("T", " "),
    }
  }

  if (value instanceof Uint8Array) {
    return { blobValue: value }
  }

  if (value instanceof ArrayBuffer) {
    return { blobValue: new Uint8Array(value) }
  }

  if (typeof value === "object") {
    const serialized = JSON.stringify(value)

    if (serialized === undefined) {
      throw new TypeError("RDS Data API parameters must be JSON-serializable")
    }

    return { stringValue: serialized }
  }

  throw new TypeError(`Unsupported RDS Data API parameter type: ${typeof value}`)
}

/** Encode one named parameter, including the Data API hint for typed values. */
export function encodeRdsDataApiParameter(name: string, value: unknown, sqlType?: SqlTypeName) {
  const typeHint = rdsDataApiTypeHint(value, sqlType)

  return {
    name,
    value: encodeRdsDataApiValue(value, sqlType),
    ...(typeHint === undefined ? {} : { typeHint }),
  }
}

function rdsDataApiTypeHint(
  value: unknown,
  sqlType?: SqlTypeName,
): "DATE" | "DECIMAL" | "JSON" | "TIMESTAMP" | "UUID" | undefined {
  if (sqlType === "date") {
    return "DATE"
  }

  if (sqlType === "timestamp") {
    return "TIMESTAMP"
  }

  if (sqlType === "uuid") {
    return "UUID"
  }

  if (sqlType === "decimal" || sqlType === "bigint") {
    return "DECIMAL"
  }

  if (typeof value === "bigint") {
    return "DECIMAL"
  }

  if (typeof value === "number" && Number.isInteger(value) && !Number.isSafeInteger(value)) {
    return "DECIMAL"
  }

  if (value instanceof Date) {
    return "TIMESTAMP"
  }

  if (
    typeof value === "object" &&
    value !== null &&
    !(value instanceof Uint8Array) &&
    !(value instanceof ArrayBuffer)
  ) {
    return "JSON"
  }

  return undefined
}

/** Decode one AWS RDS Data API `Field` without dropping binary or array values. */
export function decodeRdsDataApiField(field: Field): unknown {
  if ("isNull" in field) {
    if (field.isNull) {
      return null
    }
  }

  if ("booleanValue" in field) {
    return field.booleanValue
  }

  if ("longValue" in field) {
    return field.longValue
  }

  if ("doubleValue" in field) {
    return field.doubleValue
  }

  if ("stringValue" in field) {
    return field.stringValue
  }

  if ("blobValue" in field) {
    return field.blobValue
  }

  if ("arrayValue" in field) {
    return decodeRdsDataApiArray(field.arrayValue!)
  }

  if ("$unknown" in field) {
    throw new TypeError(`Unsupported RDS Data API field variant: ${field.$unknown![0]}`)
  }

  throw new TypeError("RDS Data API returned an empty field")
}

function decodeRdsDataApiArray(value: ArrayValue): unknown[] {
  if ("booleanValues" in value) {
    return value.booleanValues!
  }

  if ("longValues" in value) {
    return value.longValues!
  }

  if ("doubleValues" in value) {
    return value.doubleValues!
  }

  if ("stringValues" in value) {
    return value.stringValues!
  }

  if ("arrayValues" in value) {
    return value.arrayValues!.map((item) => (item === null ? null : decodeRdsDataApiArray(item)))
  }

  if ("$unknown" in value) {
    throw new TypeError(`Unsupported RDS Data API array variant: ${value.$unknown![0]}`)
  }

  throw new TypeError("RDS Data API returned an empty array field")
}

function normalizeRows(response: ExecuteStatementCommandOutput): readonly RdsDataApiRow[] {
  if (response.formattedRecords !== undefined) {
    const parsed: unknown = JSON.parse(response.formattedRecords)

    if (!Array.isArray(parsed)) {
      throw new TypeError("RDS Data API formatted records must be an array")
    }

    return parsed.map((row) => {
      if (typeof row !== "object" || row === null || Array.isArray(row)) {
        throw new TypeError("RDS Data API formatted records must contain object rows")
      }

      return row as RdsDataApiRow
    })
  }

  const metadata = response.columnMetadata ?? []

  return (response.records ?? []).map((record) => rowFromFields(record, metadata))
}

type RdsDataApiRow = Record<string, unknown>

function rowFromFields(
  fields: readonly Field[],
  metadata: readonly ColumnMetadata[],
): RdsDataApiRow {
  const row: RdsDataApiRow = {}

  fields.forEach((field, index) => {
    const column = metadata[index]
    const name = column?.label ?? column?.name ?? `column${index + 1}`

    row[name] = decodeRdsDataApiField(field)
  })
  return row
}

function generatedInsertId(
  fields: readonly Field[] | undefined,
): string | number | bigint | undefined {
  if (fields === undefined || fields.length === 0) {
    return undefined
  }

  const value = decodeRdsDataApiField(fields[0]!)

  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
    return value
  }

  return undefined
}

async function sendCommand<TResponse extends object>(
  client: RdsDataApiClient,
  command: RdsDataApiCommand,
  signal?: AbortSignal,
): Promise<TResponse> {
  const sender = client as RdsDataApiClientStub
  const response =
    signal === undefined
      ? await sender.send(command)
      : await sender.send(command, { abortSignal: signal })

  return response as unknown as TResponse
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  signal?.throwIfAborted()
}
