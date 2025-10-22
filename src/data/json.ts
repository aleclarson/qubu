import { pgType } from '../type.ts'

/**
 * PostgreSQL json type.
 */
export const json = pgType('json', JSON.stringify, JSON.parse)
