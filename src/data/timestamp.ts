import { $type, pgType } from '../core.ts'

/**
 * PostgreSQL timestamp type.
 */
export const timestamp = pgType(
  'timestamp',
  $type<Date | string>(),
  $type<Date>()
)

/**
 * PostgreSQL timestamp with time zone type.
 */
export const timestampWithTimeZone = pgType(
  'timestamptz',
  $type<Date | string>(),
  $type<Date>()
)

export { timestampWithTimeZone as timestamptz }
