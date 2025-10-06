import { dataType } from "../core.ts";

/**
 * PostgreSQL byte array type.
 */
export const bytea = dataType(
  "bytea",
  (x: Uint8Array | Buffer) => x,
  (x) => x as Buffer
);
