import { $decode, $encode, pgType } from '../type.ts'

export interface ByteArrayDefinition {
  input: unknown
  output: unknown
}

/**
 * PostgreSQL byte array type.
 */
export const bytea = pgType(
  'bytea',
  $encode<ByteArrayDefinition['input']>(),
  $decode<ByteArrayDefinition['output']>()
)
