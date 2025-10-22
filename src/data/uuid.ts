import { $type, pgType } from '../type.ts'

/**
 * PostgreSQL uuid type.
 */
export const uuid = pgType('uuid', $type<string>(), $type<string>())
