import { $decode, $encode, pgType } from '../type.ts'

/**
 * PostgreSQL interval type.
 */
export const interval = pgType('interval', $encode<string>(), $decode<string>())
