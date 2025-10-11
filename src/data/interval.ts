import { $type, pgType } from '../core.ts'

/**
 * PostgreSQL interval type.
 */
export const interval = pgType('interval', $type<string>(), $type<string>())
