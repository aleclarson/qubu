import { $type, pgType } from '../type.ts'

/**
 * PostgreSQL integer type.
 */
export const integer = pgType('integer', $type<number>(), $type<number>())
