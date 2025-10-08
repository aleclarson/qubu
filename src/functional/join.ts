import { sql, SQL, SQLParameter } from "../core.ts";

export function innerJoin(
  tableRef: Exclude<SQL.Part, SQLParameter>,
  condition: SQL
) {
  return sql(this.selection, "inner", "join", tableRef, "on", condition);
}

export function leftJoin(
  tableRef: Exclude<SQL.Part, SQLParameter>,
  condition: SQL
) {
  return sql(this.selection, "left", "join", tableRef, "on", condition);
}

export function rightJoin(
  tableRef: Exclude<SQL.Part, SQLParameter>,
  condition: SQL
) {
  return sql(this.selection, "right", "join", tableRef, "on", condition);
}

export function fullJoin(
  tableRef: Exclude<SQL.Part, SQLParameter>,
  condition: SQL
) {
  return sql(this.selection, "full", "join", tableRef, "on", condition);
}

export function crossJoin(tableRef: Exclude<SQL.Part, SQLParameter>) {
  return sql(this.selection, "cross", "join", tableRef);
}

export function naturalInnerJoin(tableRef: Exclude<SQL.Part, SQLParameter>) {
  return sql(this.selection, "natural", "inner", "join", tableRef);
}

export function naturalLeftJoin(
  tableRef: Exclude<SQL.Part, SQLParameter>,
  condition: SQL
) {
  return sql(
    this.selection,
    "natural",
    "left",
    "join",
    tableRef,
    "on",
    condition
  );
}

export function naturalRightJoin(
  tableRef: Exclude<SQL.Part, SQLParameter>,
  condition: SQL
) {
  return sql(
    this.selection,
    "natural",
    "right",
    "join",
    tableRef,
    "on",
    condition
  );
}

export function leftJoinLateral(
  tableRef: Exclude<SQL.Part, SQLParameter>,
  condition: SQL
) {
  return sql(this.selection, "left", "join", tableRef, "on", condition);
}

export function innerJoinLateral(
  tableRef: Exclude<SQL.Part, SQLParameter>,
  condition: SQL
) {
  return sql(this.selection, "inner", "join", tableRef, "on", condition);
}

export function crossJoinLateral(tableRef: Exclude<SQL.Part, SQLParameter>) {
  return sql(this.selection, "cross", "join", tableRef);
}

export function union(other: SQL) {
  return sql(this.selection, "union", other);
}
export function unionAll(other: SQL) {
  return sql(this.selection, "union", "all", other);
}

export function intersect(other: SQL) {
  return sql(this.selection, "intersect", other);
}
export function intersectAll(other: SQL) {
  return sql(this.selection, "intersect", "all", other);
}

export function except(other: SQL) {
  return sql(this.selection, "except", other);
}
export function exceptAll(other: SQL) {
  return sql(this.selection, "except", "all", other);
}
