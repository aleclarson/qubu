import { dataType } from "../core.ts";

/**
 * PostgreSQL real type.
 */
export const real = dataType(
  "real",
  (x: number) => x,
  (x) => x as number
);
