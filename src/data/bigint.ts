import { pgType } from '../core.ts'

/**
 * PostgreSQL 64-bit integer type.
 */
export const bigint = pgType(
  'bigint',
  (x: bigint) => x,
  x => x as bigint
)
