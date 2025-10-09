import { pgType } from '../core.ts'

/**
 * PostgreSQL bigserial pseudo-type.
 */
export const bigserial = pgType(
  'bigserial',
  (x: bigint) => x,
  x => x as bigint
)
