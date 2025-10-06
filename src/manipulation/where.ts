import { SQL, sql } from "../core.ts";

/**
 * Add a `WHERE` clause to the `SELECT` statement.
 *
 * You may pass multiple conditions, which will be combined using
 * `AND`. Undefined values are ignored.
 */
export function where<T extends SQL.Part[]>(...conditions: T) {
  return sql("where", ...sql.join(conditions, "and"));
}
