import { pgType } from '../type.ts'

/**
 * PostgreSQL jsonb type.
 */
export const jsonb = pgType('jsonb', JSON.stringify, JSON.parse)
