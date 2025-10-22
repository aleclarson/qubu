import { $type, pgType } from '../type.ts'

/**
 * PostgreSQL varchar type.
 */
export const varchar = (length: number) =>
  pgType(`varchar(${length})`, $type<string>(), $type<string>())
