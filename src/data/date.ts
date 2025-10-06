import { dataType } from "../core.ts";

/**
 * PostgreSQL date type.
 */
export const date = dataType(
  "date",
  (x: Date | string) => x,
  (x) => x as Date
);
