import { $decode, $encode, pgType } from '../type.ts'

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
export const timestampWithTimeZone = pgType(
  'timestamptz',
  $encode<TimestampType['input']>(),
  $decode<TimestampType['output']>()
)

export { timestampWithTimeZone as timestamptz }
