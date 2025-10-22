import { $type, pgType } from '../type.ts'

/**
 * PostgreSQL real type.
 */
export const real = pgType('real', $type<number>(), $type<number>())
