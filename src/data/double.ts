import { $type, pgType } from '../type.ts'

/**
 * PostgreSQL double precision type.
 */
export const doublePrecision = pgType(
  'double precision',
  $type<number>(),
  $type<number>()
)
