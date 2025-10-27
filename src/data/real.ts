import { $decode, $encode, pgType } from '../type.ts'

/**
 * PostgreSQL real type.
 */
export const real = pgType('real', $encode<number>(), $decode<number>())
