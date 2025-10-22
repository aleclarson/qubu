import { $type, pgType } from '../type.ts'

/**
 * PostgreSQL smallint type.
 */
export const smallint = pgType('smallint', $type<number>(), $type<number>())
