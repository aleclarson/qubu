import { $decode, $encode, pgType } from '../type.ts'

/**
 * PostgreSQL time type.
 */
export const time = pgType('time', $encode<Date | string>(), $decode<string>())

/**
 * PostgreSQL time with time zone type.
 */
export const timeWithTimeZone = pgType(
  'timetz',
  $encode<Date | string>(),
  $decode<string>()
)

export { timeWithTimeZone as timetz }
