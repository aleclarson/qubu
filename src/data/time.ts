import { pgType } from '../core.ts'

/**
 * PostgreSQL time type.
 */
export const time = pgType(
  'time',
  (x: Date | string) => x,
  x => x as string
)

/**
 * PostgreSQL time with time zone type.
 */
export const timeWithTimeZone = pgType(
  'timetz',
  (x: Date | string) => x,
  x => x as string
)

export { timeWithTimeZone as timetz }
