import type { Dialect } from "./core/dialect.ts"
import type { SqlTypeName } from "./core/sql-types.ts"

/** Portable result domains that can require driver-specific normalization. */
export type DecodableResultType = "boolean" | "date" | "timestamp" | "json" | "bigint"

/** Context supplied while decoding one projected field. */
export interface ResultDecodeContext {
  readonly dialect: Dialect
  readonly field: string
  readonly rowIndex: number
}

/** Convert one normalized driver value into its application representation. */
export type ResultDecoder<T = unknown> = (value: unknown, context: ResultDecodeContext) => T

/** Driver-specific decoders selected by a field's portable result domain. */
export type ResultDecoders = Readonly<Partial<Record<DecodableResultType, ResultDecoder>>>

/** Runtime description of one named result field. */
export interface ResultField {
  readonly name: string
  readonly type?: DecodableResultType
  readonly decoder?: ResultDecoder
  /** SQL semantic domain supplied to the adapter before it executes the request. */
  readonly sqlType?: SqlTypeName
}

/** Runtime description of a query's named result row. */
export interface ResultShape {
  readonly fields: readonly ResultField[]
}

export interface ResultValueMetadata {
  readonly type?: DecodableResultType
  readonly decoder?: ResultDecoder
  /** SQL semantic domain retained for adapter-specific result handling. */
  readonly sqlType?: SqlTypeName
}

export const resultValueMetadata: unique symbol = Symbol("qubu.result-value-metadata")

export type ResultValueCarrier = {
  readonly [resultValueMetadata]?: ResultValueMetadata
}

export function resultValue(
  type?: DecodableResultType,
  decoder?: ResultDecoder,
  sqlType?: SqlTypeName,
): ResultValueMetadata | undefined {
  return type === undefined && decoder === undefined && sqlType === undefined
    ? undefined
    : Object.freeze({
        ...(type === undefined ? {} : { type }),
        ...(decoder === undefined ? {} : { decoder }),
        ...(sqlType === undefined ? {} : { sqlType }),
      })
}

export function resultValueOf(value: unknown): ResultValueMetadata | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined
  }

  return (value as ResultValueCarrier)[resultValueMetadata]
}

export function attachResultValue<T extends object>(
  value: T,
  metadata?: ResultValueMetadata,
): T & ResultValueCarrier {
  if (metadata === undefined) {
    return value
  }

  return Object.freeze({
    ...value,
    [resultValueMetadata]: metadata,
  })
}

export function createResultShape(fields: readonly ResultField[]): ResultShape {
  return Object.freeze({
    fields: Object.freeze(fields.map((field) => Object.freeze({ ...field }))),
  })
}

export function resultShapeValue(
  shape: ResultShape,
  name: string,
): ResultValueMetadata | undefined {
  const field = shape.fields.find((candidate) => candidate.name === name)

  return field === undefined ? undefined : resultValue(field.type, field.decoder, field.sqlType)
}

/** Decode SQLite/MySQL-style boolean values while accepting native booleans. */
export const booleanResultDecoder: ResultDecoder<boolean> = (value) => {
  if (typeof value === "boolean") {
    return value
  }

  if (value === 0 || value === 0n) {
    return false
  }

  if (value === 1 || value === 1n) {
    return true
  }

  throw new TypeError("Expected a boolean or numeric 0/1 result")
}

/** Decode a SQL DATE string as a JavaScript Date at UTC midnight. */
export const dateResultDecoder: ResultDecoder<Date> = (value) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value
  }

  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new TypeError("Expected a valid Date or YYYY-MM-DD result")
  }

  const decoded = new Date(`${value}T00:00:00.000Z`)

  if (Number.isNaN(decoded.getTime()) || decoded.toISOString().slice(0, 10) !== value) {
    throw new TypeError("Expected a valid calendar date result")
  }

  return decoded
}

/** Decode a SQL/ISO timestamp string while accepting driver-created Dates. */
export const timestampResultDecoder: ResultDecoder<Date> = (value) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value
  }

  if (typeof value !== "string") {
    throw new TypeError("Expected a valid Date or timestamp string result")
  }

  const normalized = value.includes("T") ? value : value.replace(" ", "T")
  const decoded = new Date(
    /(?:Z|[+-]\d{2}:?\d{2})$/u.test(normalized) ? normalized : `${normalized}Z`,
  )

  if (Number.isNaN(decoded.getTime())) {
    throw new TypeError("Expected a valid timestamp result")
  }

  return decoded
}

/** Decode a serialized JSON result. Use only when the adapter returns JSON text. */
export const jsonTextResultDecoder: ResultDecoder = (value) => {
  if (typeof value !== "string") {
    return value
  }

  return JSON.parse(value) as unknown
}

/** Decode an exact integer result without ever accepting an unsafe JavaScript number. */
export const bigintResultDecoder: ResultDecoder<bigint> = (value) => {
  if (typeof value === "bigint") {
    return value
  }

  if (typeof value === "number") {
    if (Number.isSafeInteger(value)) {
      return BigInt(value)
    }

    throw new TypeError("Expected a bigint, canonical integer string, or safe integer result")
  }

  if (typeof value !== "string" || !/^[+-]?\d+$/u.test(value)) {
    throw new TypeError("Expected a bigint, canonical integer string, or safe integer result")
  }

  return BigInt(value)
}

/** Error raised when a projected driver value cannot be decoded. */
export class ResultDecodingError extends TypeError {
  readonly name = "ResultDecodingError"
  readonly field: string
  readonly rowIndex: number
  readonly resultType?: DecodableResultType

  constructor(field: string, rowIndex: number, resultType: DecodableResultType | undefined) {
    super(
      `Could not decode result field "${field}" in row ${rowIndex}${
        resultType === undefined ? "" : ` as ${resultType}`
      }`,
    )
    this.field = field
    this.rowIndex = rowIndex
    this.resultType = resultType
  }
}

export function decodeResultRow<TRow extends object>(
  row: Readonly<Record<string, unknown>>,
  shape: ResultShape,
  decoders: ResultDecoders | undefined,
  dialect: Dialect,
  rowIndex: number,
): TRow {
  let decoded: Record<string, unknown> | undefined

  for (const field of shape.fields) {
    const decoder =
      field.decoder ??
      (field.type === "bigint"
        ? (decoders?.bigint ?? bigintResultDecoder)
        : field.type
          ? decoders?.[field.type]
          : undefined)

    if (decoder === undefined || row[field.name] === null) {
      continue
    }

    try {
      decoded ??= { ...row }
      decoded[field.name] = decoder(row[field.name], {
        dialect,
        field: field.name,
        rowIndex,
      })
    } catch {
      throw new ResultDecodingError(field.name, rowIndex, field.type)
    }
  }

  return (decoded ?? row) as TRow
}
