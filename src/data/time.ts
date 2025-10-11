import { $type, pgType } from '../core.ts'

/**
 * PostgreSQL time type.
 */
export const time = pgType('time', $type<Date | string>(), $type<string>())

/**
 * PostgreSQL time with time zone type.
 */
export const timeWithTimeZone = pgType(
  'timetz',
  $type<Date | string>(),
  $type<string>()
)

export { timeWithTimeZone as timetz }
