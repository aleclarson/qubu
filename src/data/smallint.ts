import { pgType } from '../core.ts'

/**
 * PostgreSQL smallint type.
 */
export const smallint = pgType(
  'smallint',
  (x: number) => x,
  x => x as number
)
