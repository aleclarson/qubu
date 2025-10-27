import { $decode, $encode, pgType } from '../type.ts'

/**
 * PostgreSQL smallint type.
 */
export const smallint = pgType('smallint', $encode<number>(), $decode<number>())
