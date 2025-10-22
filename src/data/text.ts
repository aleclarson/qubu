import { $type, pgType } from '../type.ts'

/**
 * PostgreSQL text type.
 */
export const text = pgType('text', $type<string>(), $type<string>())
