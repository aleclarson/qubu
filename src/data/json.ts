import { pgType } from '../core.ts'

/**
 * PostgreSQL json type.
 */
export const json = pgType(
  'json',
  x => x,
  x => x
)
