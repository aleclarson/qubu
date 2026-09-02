import type { RowDataPacket } from "mysql2/promise"
import {
  booleanResultDecoder,
  type DriverValueEncoder,
  type ExecutionRequest,
  type ExecutionResult,
  type ExplainableQueryAdapter,
  type ExplainRequest,
  type ExplainResult,
  type TransactionOptions,
  type TransactionalQueryAdapter,
} from "qubu"
import { mysqlDialect } from "qubu/mysql"

export interface Mysql2AdapterOptions {
  readonly encoder?: DriverValueEncoder
}

interface Mysql2ExecuteOptions {
  readonly sql: string
  readonly values: any[]
  readonly rowsAsArray: false
  readonly nestTables: false
}

export interface Mysql2Connection {
  execute(options: Mysql2ExecuteOptions): Promise<[unknown, readonly unknown[]]>
  beginTransaction(): Promise<void>
  commit(): Promise<void>
  rollback(): Promise<void>
}

export interface Mysql2TransactionAdapter extends ExplainableQueryAdapter<RowDataPacket> {}

export interface Mysql2Adapter
  extends
    ExplainableQueryAdapter<RowDataPacket>,
    TransactionalQueryAdapter<Mysql2TransactionAdapter> {
  readonly connection: Mysql2Connection
}

const identityEncoder: DriverValueEncoder = { encode: (value) => value }
const mysql2Decoders = Object.freeze({
  boolean: booleanResultDecoder,
})

/** Adapt one application-owned `mysql2/promise` connection. */
export function mysql2Adapter(
  connection: Mysql2Connection,
  options: Mysql2AdapterOptions = {},
): Mysql2Adapter {
  const scoped = executionAdapter(connection, options.encoder ?? identityEncoder)

  return {
    ...scoped,
    connection,
    async transaction<T>(
      callback: (adapter: Mysql2TransactionAdapter) => Promise<T>,
      transactionOptions: TransactionOptions = {},
    ): Promise<T> {
      throwIfAborted(transactionOptions.signal)
      await connection.beginTransaction()

      let committed = false

      try {
        throwIfAborted(transactionOptions.signal)
        const result = await callback(scoped)

        throwIfAborted(transactionOptions.signal)
        await connection.commit()
        committed = true
        throwIfAborted(transactionOptions.signal)
        return result
      } catch (error) {
        if (committed) {
          throw error
        }

        return rollbackAndRethrow(connection, error)
      }
    },
  }
}

function executionAdapter(
  connection: Mysql2Connection,
  encoder: DriverValueEncoder,
): Mysql2TransactionAdapter {
  return {
    dialect: mysqlDialect(),
    decoders: mysql2Decoders,
    async execute<TRow extends object>(request: ExecutionRequest) {
      throwIfAborted(request.signal)
      const [result] = await executeStatement(connection, encoder, request)

      throwIfAborted(request.signal)

      if (Array.isArray(result)) {
        return {
          rows: normalizeRows<TRow>(
            result,
            "execute",
            request.resultShape.fields.map((field) => field.name),
          ),
        }
      }

      const header = normalizeHeader(result)

      return {
        rows: [],
        affectedRows: header.affectedRows,
        ...(header.changedRows === undefined ? {} : { changedRows: header.changedRows }),
        ...(request.queryKind === "insert" && header.insertId !== undefined
          ? { insertId: header.insertId }
          : {}),
      } satisfies ExecutionResult<TRow>
    },
    async explain(request: ExplainRequest) {
      throwIfAborted(request.signal)
      const [result] = await executeStatement(connection, encoder, request)

      throwIfAborted(request.signal)

      if (!Array.isArray(result)) {
        throw new TypeError("mysql2 EXPLAIN returned a non-row result")
      }

      return {
        rows: normalizeRows<RowDataPacket>(result, "EXPLAIN"),
      } satisfies ExplainResult<RowDataPacket>
    },
  }
}

async function executeStatement(
  connection: Mysql2Connection,
  encoder: DriverValueEncoder,
  request: ExecutionRequest,
): Promise<[unknown, readonly unknown[]]> {
  return connection.execute({
    sql: request.statement.text,
    values: request.statement.parameters.map((value) => encodeParameter(value, encoder)),
    rowsAsArray: false,
    nestTables: false,
  })
}

function encodeParameter(value: unknown, encoder: DriverValueEncoder): unknown {
  const encoded = encoder.encode(value)

  return encoded === undefined ? null : encoded
}

function normalizeRows<TRow extends object>(
  result: unknown[],
  operation: string,
  expectedFields?: readonly string[],
): readonly TRow[] {
  if (expectedFields?.length === 0 && result.length > 0 && result.every(isResultHeader)) {
    throw new TypeError(`mysql2 ${operation} returned multiple result headers`)
  }

  for (const [index, row] of result.entries()) {
    if (!isObjectRow(row)) {
      throw new TypeError(`mysql2 ${operation} returned an invalid row at index ${index}`)
    }

    if (expectedFields !== undefined) {
      for (const field of expectedFields) {
        if (!Object.hasOwn(row, field)) {
          throw new TypeError(`mysql2 ${operation} row ${index} is missing result field "${field}"`)
        }
      }
    }
  }

  return result as readonly TRow[]
}

function normalizeHeader(result: unknown): {
  readonly affectedRows: number | bigint
  readonly changedRows?: number | bigint
  readonly insertId?: string | number | bigint
} {
  if (!isResultHeader(result)) {
    throw new TypeError("mysql2 returned an unsupported result shape")
  }

  return result
}

function isObjectRow(value: unknown): value is object {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isResultHeader(value: unknown): value is {
  readonly affectedRows: number | bigint
  readonly changedRows?: number | bigint
  readonly insertId?: string | number | bigint
} {
  if (!isObjectRow(value)) {
    return false
  }

  const header = value as Record<string, unknown>

  return (
    isNumericResultValue(header.affectedRows) &&
    (header.changedRows === undefined || isNumericResultValue(header.changedRows)) &&
    (header.insertId === undefined ||
      typeof header.insertId === "string" ||
      isNumericResultValue(header.insertId))
  )
}

function isNumericResultValue(value: unknown): value is number | bigint {
  return typeof value === "number" || typeof value === "bigint"
}

async function rollbackAndRethrow(connection: Mysql2Connection, error: unknown): Promise<never> {
  try {
    await connection.rollback()
  } catch (rollbackError) {
    throw new AggregateError(
      [error, rollbackError],
      "mysql2 transaction failed and rollback failed",
      { cause: error },
    )
  }

  throw error
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  signal?.throwIfAborted()
}
