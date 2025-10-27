import { $encode, pgType } from '../type.ts'

/**
 * PostgreSQL bigserial pseudo-type.
 */
export const bigserial = pgType('bigserial', $encode<bigint>(), BigInt, false)
