import { dataType } from "../core.ts";

/**
 * PostgreSQL jsonb type.
 */
export const jsonb = dataType(
  "jsonb",
  (x) => x,
  (x) => x
);
