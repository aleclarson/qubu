import { $decode, $encode, pgType } from '../type.ts'

/**
 * PostgreSQL date type.
 */
export const date = pgType('date', $encode<Date | string>(), $decode<Date>())
