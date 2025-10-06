import { dataType } from "../core.ts";

/**
 * PostgreSQL varchar type.
 */
export const varchar = (length: number) =>
  dataType(
    `varchar(${length})`,
    (x: string) => x,
    (x) => x as string
  );
