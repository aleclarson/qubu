import { dataType } from "../core.ts";

/**
 * PostgreSQL 64-bit integer type.
 */
export const bigint = dataType(
  "bigint",
  (x: bigint) => x,
  (x) => x as bigint
);
