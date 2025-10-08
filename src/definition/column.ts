import { array, comma, DataType, sql, SQL, unsafe } from "../core.ts";
import type { Table } from "./table.ts";

export type OnDeleteAction =
  | "restrict"
  | "cascade"
  | "set null"
  | "set default"
  | "no action";

export type OnUpdateAction =
  | "restrict"
  | "cascade"
  | "set null"
  | "set default"
  | "no action";

type OneOrMore<T> = T | T[];

export class Column<
  In = any,
  Out = any,
  Nullable extends boolean = any
> extends SQL<Out | (Nullable extends true ? null : never)> {
  declare table: Table<any>;
  constraints: (SQL.Part | (() => SQL))[] = [];
  constructor(
    public name: string,
    public parser: DataType<string, In, Out>,
    public nullable: Nullable
  ) {
    super([]);
  }
  /**
   * Narrow the column's data type. This has no effect at runtime, but
   * is especially useful for JSON types if you don't need input
   * validation at runtime.
   */
  mapWith<T extends Out>(): Column<Extract<T, In>, T, Nullable>;
  mapWith<T extends In, U extends Out>(): Column<T, U, Nullable>;
  mapWith() {
    return this as any;
  }
  /**
   * Update the column's data type to an array.
   */
  array(): Column<In[], Out[], Nullable> {
    this.parser = array(this.parser) as any;
    return this as any;
  }
  /**
   * Update the column's nullable state to false.
   */
  notNull(): Column<In, Out, false> {
    this.nullable = false as any;
    return this as any;
  }
  primaryKey(): Column<In, Out, false> {
    this.constraints.push(unsafe("primary key"));
    return this as any;
  }
  unique() {
    this.constraints.push(unsafe("unique"));
    return this;
  }
  check(expression: SQL.Part[]) {
    this.constraints.push(unsafe("check"), expression);
    return this;
  }
  references(resolve: () => OneOrMore<Column>) {
    this.constraints.push(unsafe("references"), () => {
      const columns = resolve();
      return Array.isArray(columns)
        ? sql(columns[0].table, [sql.sequence(columns, comma)])
        : sql(columns.table, [columns]);
    });
    return this;
  }
  onDelete(action: OnDeleteAction) {
    this.constraints.push(unsafe("on delete"), unsafe(action));
    return this;
  }
  onUpdate(action: OnUpdateAction) {
    this.constraints.push(unsafe("on update"), unsafe(action));
    return this;
  }
}
