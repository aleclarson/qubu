import { pgType } from "../core.ts";

/**
 * PostgreSQL interval type.
 */
export const interval = pgType(
  "interval",
  (x: string) => x,
  (x) => x as string
);
