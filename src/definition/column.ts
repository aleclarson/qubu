import { array, DataType, SQL } from "../core.ts";
import type { PgTable } from "./table.ts";

export class PgColumn<
  In = any,
  Out = any,
  Nullable extends boolean = any
> extends SQL<{}, Out | (Nullable extends true ? null : never)> {
  dataType: DataType<string, In, Out>;
  declare table: PgTable<any>;
  constructor(public name: string, dataType: DataType<string, In, Out>) {
    super();
    this.dataType = dataType;
  }
  /**
   * Returns a new `PgColumn` with the same name, but with an array
   * data type.
   */
  array(): SQL<{}, Out[] | null> {
    this.dataType = array(this.dataType) as any;
    return this as any;
  }
  /**
   * Returns a new `PgColumn` with the same name, but with a
   * two-dimensional array data type.
   */
  array2D() {
    return new PgColumn(this.name, array(array(this.dataType)));
  }
  notNull() {}
}
