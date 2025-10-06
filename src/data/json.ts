import { dataType } from "../core.ts";

/**
 * PostgreSQL json type.
 */
export const json = dataType(
  "json",
  (x) => x,
  (x) => x
);
