import { pgType } from '../core.ts'

/**
 * PostgreSQL uuid type.
 */
export const uuid = pgType(
  'uuid',
  (x: string) => x,
  x => x as string
)
