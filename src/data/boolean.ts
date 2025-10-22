import { $type, pgType } from '../type.ts'

/**
 * PostgreSQL boolean type.
 */
export const boolean = pgType('boolean', $type<boolean>(), $type<boolean>())
