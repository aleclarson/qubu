import { $type, pgType } from '../type.ts'

/**
 * PostgreSQL character type.
 */
export const char = pgType('char', $type<string>(), $type<string>())
