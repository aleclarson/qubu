import { dataType } from "../core.ts";

/**
 * PostgreSQL text type.
 */
export const text = dataType(
  "text",
  (x: string) => x,
  (x) => x as string
);
