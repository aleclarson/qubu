import { pgType } from "../core.ts";

/**
 * PostgreSQL date type.
 */
export const date = pgType(
  "date",
  (x: Date | string) => x,
  (x) => x as Date
);
