import { pgType } from '../core.ts'

/**
 * PostgreSQL double precision type.
 */
export const doublePrecision = pgType(
  'double precision',
  (x: number) => x,
  x => x as number
)
