import { $type, pgType } from '../core.ts'

/**
 * PostgreSQL smallint type.
 */
export const smallint = pgType('smallint', $type<number>(), $type<number>())
