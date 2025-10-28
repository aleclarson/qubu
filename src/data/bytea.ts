import { $decode, $encode, pgType } from '../type.ts'

/**
 * The JS type for `bytea` columns is determined by the client
 * adapter.
 */
export interface ByteArrayType {
  input: unknown
  output: unknown
}

/**
 * PostgreSQL byte array type.
 */
export const bytea = pgType(
  'bytea',
  $encode<ByteArrayType['input']>(),
  $decode<ByteArrayType['output']>()
)
