import { $decode, $encode, pgType } from '../type.ts'

/**
 * PostgreSQL integer type.
 */
export const integer = pgType('integer', $encode<number>(), $decode<number>())
