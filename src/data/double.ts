import { dataType } from "../core.ts";

/**
 * PostgreSQL double precision type.
 */
export const doublePrecision = dataType(
  "double precision",
  (x: number) => x,
  (x) => x as number
);
