import { comma, SQL, sql, unsafe } from "../core.ts";

export const select = <T extends SQL.Part[]>(...args: T) =>
  sql(unsafe("select"), ...args).withPrototype(PgSelectFrom);

export type InferParams<T extends SQL> = T extends SQL<infer P> ? P : never;

class PgSelectFrom<T = any> {
  constructor(readonly selection: SQL<T>) {}

  from(tableRef: SQL.Part) {
    return sql(this.selection, unsafe("from"), tableRef)
      .$type(this.selection.dataType)
      .withPrototype(PgSelect<T>);
  }

  toQuery() {
    // TODO
  }
}

export class PgSelect<T = any> {
  constructor(readonly selection: SQL<T>) {}

  protected append(...parts: SQL.Part[]) {
    return sql(this.selection, ...parts)
      .$type(this.selection.dataType)
      .withPrototype(PgSelect<T>);
  }

  /**
   * Add a `WHERE` clause to the `SELECT` statement.
   *
   * You may pass multiple conditions, which will be combined using
   * `AND`. Undefined values are ignored.
   */
  where(...parts: SQL.Part[]) {
    const whereClause = sql.sequence(parts, unsafe("and"));
    return whereClause ? this.append(unsafe("where"), whereClause) : this;
  }

  orderBy(...parts: SQL.Part[]) {
    const orderByClause = sql.sequence(parts, comma);
    return orderByClause
      ? this.append(unsafe("order by"), orderByClause)
      : this;
  }

  toQuery() {
    // TODO
  }
}
