import { dataType } from "../core.ts";

/**
 * PostgreSQL character type.
 */
export const char = dataType(
  "char",
  (x: string) => x,
  (x) => x as string
);
