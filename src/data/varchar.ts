import { $decode, $encode, pgType } from '../type.ts'

/**
 * PostgreSQL varchar type.
 */
export const varchar = (length: number) =>
  pgType(`varchar(${length})`, $encode<string>(), $decode<string>())
