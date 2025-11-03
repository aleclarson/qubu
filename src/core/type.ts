import { SQL } from '../core.ts'
import { Column } from '../definition/column.ts'
import { PgType } from './symbols.ts'

export const noopDecoder = (arg: unknown) => arg

/**
 * Shortcut for encoding and decoding functions that don't do any
 * processing. Exists for type safety at compile time.
 */
export const $encode = <T>() => noopDecoder as (value: T) => T

/**
 * Shortcut for decoding functions that don't do any processing.
 * Exists for type safety at compile time.
 */
export const $decode = <T>() => noopDecoder as (value: unknown) => T

/**
 * Declare a database type, with serialization and parsing functions.
 */
export function pgType<
  Id extends string,
  In,
  Out,
  DefaultNullable extends boolean = true,
>(
  id: Id,
  encode: (jsType: In) => any,
  decode: (sqlType: any) => Out,
  nullable = true as DefaultNullable
) {
  function type(name = '') {
    return new Column(name, type, nullable)
  }
  type[PgType] = id
  type.encode = encode
  type.decode = decode
  return type
}

/**
 * Declare an array variant of a given data type.
 */
export function array<Id extends string, In, Out>(
  itemType: SQL.Type<Id, In, Out>
): SQL.Type<`${Id}[]`, In[], Out[]> {
  return pgType(
    `${itemType[PgType]}[]`,
    (data: In[]) =>
      data.map(item => {
        return item == null ? null : itemType.encode(item)
      }),
    (data: any[]) => data.map(itemType.decode)
  )
}

/**
 * Column type for 64-bit integers.
 */
export const bigint = pgType('bigint', $encode<bigint>(), BigInt)

/**
 * Column type for 64-bit integers that are automatically generated.
 */
export const bigserial = pgType('bigserial', $encode<bigint>(), BigInt, false)

/**
 * PostgreSQL boolean type.
 */
export const boolean = pgType('boolean', $encode<boolean>(), $decode<boolean>())

/**
 * PostgreSQL byte array type.
 */
export const bytea = pgType(
  'bytea',
  $encode<ByteArrayType['input']>(),
  $decode<ByteArrayType['output']>()
)

/**
 * The JS type for `bytea` columns is determined by the client
 * adapter.
 */
export interface ByteArrayType {
  input: unknown
  output: unknown
}

/**
 * PostgreSQL character type.
 */
export const char = pgType('char', $encode<string>(), $decode<string>())

/**
 * PostgreSQL date type.
 */
export const date = pgType(
  'date',
  $encode<DateType['input']>(),
  $decode<DateType['output']>()
)

/**
 * The JS type for `date` columns is determined by the client
 * adapter.
 */
export interface DateType {
  input: unknown
  output: unknown
}

/**
 * PostgreSQL double precision type.
 */
export const doublePrecision = pgType(
  'double precision',
  $encode<number>(),
  $decode<number>()
)

/**
 * PostgreSQL integer type.
 */
export const integer = pgType('integer', $encode<number>(), $decode<number>())

/**
 * PostgreSQL interval type.
 */
export const interval = pgType('interval', $encode<string>(), $decode<string>())

/**
 * PostgreSQL json type.
 */
export const json = pgType('json', JSON.stringify, JSON.parse)

/**
 * PostgreSQL jsonb type.
 */
export const jsonb = pgType('jsonb', JSON.stringify, JSON.parse)

/**
 * PostgreSQL numeric type.
 */
export const numeric = (precision?: number, scale?: number) =>
  pgType(
    `numeric${
      precision !== undefined
        ? `(${precision}${scale !== undefined ? `,${scale}` : ''})`
        : ''
    }`,
    $encode<number>(),
    $decode<number>()
  )

/**
 * PostgreSQL real type.
 */
export const real = pgType('real', $encode<number>(), $decode<number>())

/**
 * PostgreSQL serial pseudo-type.
 */
export const serial = pgType(
  'serial',
  $encode<number>(),
  $decode<number>(),
  false
)

/**
 * PostgreSQL smallint type.
 */
export const smallint = pgType('smallint', $encode<number>(), $decode<number>())

/**
 * PostgreSQL text type.
 */
export const text = pgType('text', $encode<string>(), $decode<string>())

/**
 * The JS type for `time` and `timetz` columns is determined by the
 * client adapter.
 */
export interface TimeType {
  input: unknown
  output: unknown
}

/**
 * PostgreSQL time type.
 */
export const time = pgType(
  'time',
  $encode<TimeType['input']>(),
  $decode<TimeType['output']>()
)

/**
 * PostgreSQL time with time zone type.
 */
export const timetz = pgType(
  'timetz',
  $encode<TimeType['input']>(),
  $decode<TimeType['output']>()
)

export { timetz as timeWithTimeZone }

/**
 * The JS type for `timestamp` and `timestamptz` columns is determined
 * by the client adapter.
 */
export interface TimestampType {
  input: unknown
  output: unknown
}

/**
 * PostgreSQL timestamp type.
 */
export const timestamp = pgType(
  'timestamp',
  $encode<TimestampType['input']>(),
  $decode<TimestampType['output']>()
)

/**
 * PostgreSQL timestamp with time zone type.
 */
export const timestamptz = pgType(
  'timestamptz',
  $encode<TimestampType['input']>(),
  $decode<TimestampType['output']>()
)

export { timestamptz as timestampWithTimeZone }

/**
 * Column type for UUID strings.
 */
export const uuid = pgType('uuid', $encode<string>(), $decode<string>())

/**
 * Column type for variable-length character strings.
 */
export const varchar = (length: number) =>
  pgType(`varchar(${length})`, $encode<string>(), $decode<string>())
