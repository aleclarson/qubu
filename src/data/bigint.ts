import { $decode, $encode, pgType } from '../type.ts'

/**
 * PostgreSQL 64-bit integer type.
 */
export const bigint = pgType('bigint', $encode<bigint>(), $decode<bigint>())
