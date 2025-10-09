import { pgType } from '../core.ts'

/**
 * PostgreSQL integer type.
 */
export const integer = pgType(
  'integer',
  (x: number) => x,
  x => x as number
)
