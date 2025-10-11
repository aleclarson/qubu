import { pgType } from '../core.ts'

/**
 * PostgreSQL json type.
 */
export const json = pgType('json', JSON.stringify, JSON.parse)
