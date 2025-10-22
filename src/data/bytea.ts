import { $type, pgType } from '../type.ts'

/**
 * PostgreSQL byte array type.
 */
export const bytea = pgType(
  'bytea',
  $type<Uint8Array | Buffer>(),
  $type<Buffer>()
)
