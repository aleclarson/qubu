import { $type, pgType } from '../type.ts'

/**
 * PostgreSQL bigserial pseudo-type.
 */
export const bigserial = pgType('bigserial', $type<bigint>(), BigInt, false)
