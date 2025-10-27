import { $decode, $encode, pgType } from '../type.ts'

/**
 * PostgreSQL text type.
 */
export const text = pgType('text', $encode<string>(), $decode<string>())
