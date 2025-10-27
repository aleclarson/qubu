import { $encode, pgType } from '../type.ts'

/**
 * PostgreSQL boolean type.
 */
export const boolean = pgType('boolean', $encode<boolean>(), $encode<boolean>())
