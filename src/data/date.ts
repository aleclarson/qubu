import { $type, pgType } from '../core.ts'

/**
 * PostgreSQL date type.
 */
export const date = pgType('date', $type<Date | string>(), $type<Date>())
