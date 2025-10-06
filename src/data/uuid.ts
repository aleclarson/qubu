import { dataType } from "../core.ts";

/**
 * PostgreSQL uuid type.
 */
export const uuid = dataType(
  "uuid",
  (x: string) => x,
  (x) => x as string
);
