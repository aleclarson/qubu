import { pgType } from '../core.ts'

/**
 * PostgreSQL byte array type.
 */
export const bytea = pgType(
  'bytea',
  (x: Uint8Array | Buffer) => x,
  x => x as Buffer
)
