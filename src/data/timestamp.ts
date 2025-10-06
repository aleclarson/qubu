import { dataType } from "../core.ts";

/**
 * PostgreSQL timestamp type.
 */
export const timestamp = dataType<"timestamp", Date, Date>(
  "timestamp",
  (x: Date | string) => x,
  (x) => x as Date
);

/**
 * PostgreSQL timestamp with time zone type.
 */
export const timestampWithTimeZone = dataType(
  "timestamptz",
  (x: Date | string) => x,
  (x) => x as Date
);

export { timestampWithTimeZone as timestamptz };
