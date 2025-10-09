import { pgType } from "../core.ts";

/**
 * PostgreSQL real type.
 */
export const real = pgType(
  "real",
  (x: number) => x,
  (x) => x as number
);
