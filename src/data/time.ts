import { $decode, $encode, pgType } from '../type.ts'

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
export const timeWithTimeZone = pgType(
  'timetz',
  $encode<TimeType['input']>(),
  $decode<TimeType['output']>()
)

export { timeWithTimeZone as timetz }
