import { $type, pgType } from '../core.ts'

/**
 * PostgreSQL serial pseudo-type.
 */
export const serial = pgType('serial', $type<number>(), $type<number>())
