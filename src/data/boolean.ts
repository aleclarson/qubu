import { $type, pgType } from '../core.ts'

/**
 * PostgreSQL boolean type.
 */
export const boolean = pgType('boolean', $type<boolean>(), $type<boolean>())
