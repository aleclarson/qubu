import { $type, pgType } from '../type.ts'

/**
 * PostgreSQL 64-bit integer type.
 */
export const bigint = pgType('bigint', $type<bigint>(), $type<bigint>())
