import { $decode, $encode, pgType } from '../type.ts'

/**
 * PostgreSQL serial pseudo-type.
 */
export const serial = pgType('serial', $encode<number>(), $decode<number>())
