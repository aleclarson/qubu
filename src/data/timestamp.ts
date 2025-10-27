import { $decode, $encode, pgType } from '../type.ts'

/**
 * PostgreSQL timestamp type.
 */
export const timestamp = pgType(
  'timestamp',
  $encode<Date | string>(),
  $decode<Date>()
)

/**
 * PostgreSQL timestamp with time zone type.
 */
export const timestampWithTimeZone = pgType(
  'timestamptz',
  $encode<Date | string>(),
  $decode<Date>()
)

export { timestampWithTimeZone as timestamptz }
