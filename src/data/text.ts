import { $type, pgType } from '../core.ts'

/**
 * PostgreSQL text type.
 */
export const text = pgType('text', $type<string>(), $type<string>())
