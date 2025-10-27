import { $decode, $encode, pgType } from '../type.ts'

/**
 * PostgreSQL character type.
 */
export const char = pgType('char', $encode<string>(), $decode<string>())
