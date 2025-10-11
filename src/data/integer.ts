import { $type, pgType } from '../core.ts'

/**
 * PostgreSQL integer type.
 */
export const integer = pgType('integer', $type<number>(), $type<number>())
