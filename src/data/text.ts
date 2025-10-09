import { pgType } from "../core.ts";

/**
 * PostgreSQL text type.
 */
export const text = pgType(
  "text",
  (x: string) => x,
  (x) => x as string
);
