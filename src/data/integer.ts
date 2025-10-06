import { dataType } from "../core.ts";

/**
 * PostgreSQL integer type.
 */
export const integer = dataType(
  "integer",
  (x: number) => x,
  (x) => x as number
);
