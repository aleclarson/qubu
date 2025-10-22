import { $type, pgType } from '../type.ts'

/**
 * PostgreSQL serial pseudo-type.
 */
export const serial = pgType('serial', $type<number>(), $type<number>())
