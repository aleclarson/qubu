import { pgType } from "../core.ts";

/**
 * PostgreSQL varchar type.
 */
export const varchar = (length: number) =>
  pgType(
    `varchar(${length})`,
    (x: string) => x,
    (x) => x as string
  );
