import { pgType } from "../core.ts";

/**
 * PostgreSQL boolean type.
 */
export const boolean = pgType(
  "boolean",
  (x: boolean) => x,
  (x) => x as boolean
);
