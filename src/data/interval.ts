import { dataType } from "../core.ts";

/**
 * PostgreSQL interval type.
 */
export const interval = dataType(
  "interval",
  (x: string) => x,
  (x) => x as string
);
