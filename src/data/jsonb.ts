import { pgType } from "../core.ts";

/**
 * PostgreSQL jsonb type.
 */
export const jsonb = pgType(
  "jsonb",
  (x) => x,
  (x) => x
);
