import { $type, pgType } from '../type.ts'

/**
 * PostgreSQL date type.
 */
export const date = pgType('date', $type<Date | string>(), $type<Date>())
