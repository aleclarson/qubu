import { pgType } from "../core.ts";

/**
 * PostgreSQL serial pseudo-type.
 */
export const serial = pgType(
  "serial",
  (x: number) => x,
  (x) => x as number
);
