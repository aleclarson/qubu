import { $type, pgType } from '../core.ts'

/**
 * PostgreSQL uuid type.
 */
export const uuid = pgType('uuid', $type<string>(), $type<string>())
