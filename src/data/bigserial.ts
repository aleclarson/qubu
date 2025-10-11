import { $type, pgType } from '../core.ts'

/**
 * PostgreSQL bigserial pseudo-type.
 */
export const bigserial = pgType('bigserial', $type<bigint>(), BigInt, false)
