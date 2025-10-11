import { $type, pgType } from '../core.ts'

/**
 * PostgreSQL character type.
 */
export const char = pgType('char', $type<string>(), $type<string>())
