import { $type, pgType } from '../core.ts'

/**
 * PostgreSQL real type.
 */
export const real = pgType('real', $type<number>(), $type<number>())
