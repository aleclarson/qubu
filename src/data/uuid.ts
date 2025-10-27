import { $decode, $encode, pgType } from '../type.ts'

/**
 * PostgreSQL uuid type.
 */
export const uuid = pgType('uuid', $encode<string>(), $decode<string>())
