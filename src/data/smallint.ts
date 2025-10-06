import { dataType } from "../core.ts";

/**
 * PostgreSQL smallint type.
 */
export const smallint = dataType(
  "smallint",
  (x: number) => x,
  (x) => x as number
);
