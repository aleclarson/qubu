import { dataType } from "../core.ts";

/**
 * PostgreSQL boolean type.
 */
export const boolean = dataType(
  "boolean",
  (x: boolean) => x,
  (x) => x as boolean
);
