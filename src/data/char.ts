import { pgType } from '../core.ts'

/**
 * PostgreSQL character type.
 */
export const char = pgType(
  'char',
  (x: string) => x,
  x => x as string
)
