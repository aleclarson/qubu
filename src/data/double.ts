import { $decode, $encode, pgType } from '../type.ts'

/**
 * PostgreSQL double precision type.
 */
export const doublePrecision = pgType(
  'double precision',
  $encode<number>(),
  $decode<number>()
)
