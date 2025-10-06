import { dataType } from "../core.ts";

/**
 * PostgreSQL time type.
 */
export const time = dataType(
  "time",
  (x: Date | string) => x,
  (x) => x as string
);

/**
 * PostgreSQL time with time zone type.
 */
export const timeWithTimeZone = dataType(
  "timetz",
  (x: Date | string) => x,
  (x) => x as string
);

export { timeWithTimeZone as timetz };
