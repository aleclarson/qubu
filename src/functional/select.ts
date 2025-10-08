import { noop } from "radashi";
import {
  comma,
  DataType,
  dataType,
  SQL,
  sql,
  tokenize,
  unsafe,
} from "../core.ts";
import { Column } from "../definition/column.ts";
import { isPlainObject } from "../util.ts";

export const select = <T extends (SQL.Part | Record<string, SQL.Part>)[]>(
  ...args: T
) => {
  const types: Record<string, DataType> = {};
  const selected = args.map((arg) => {
    if (isPlainObject(arg)) {
      return sql.sequence(
        Object.entries(arg).map(([alias, value]) => {
          if (value instanceof Column) {
            types[alias] = value.dataType;
            return value.name === alias ? value : value.as(alias);
          }
          // TODO: assign type
          return (value instanceof SQL ? value : sql(value)).as(alias);
        }),
        comma
      );
    }
    return arg;
  });

  return sql(unsafe("select"), sql.sequence(selected, comma)).$type(
    dataType("", noop, (rows) => {
      // TODO
      return rows;
    })
  );
};

export const from = (tableRef: SQL.Part) => sql(unsafe("from"), tableRef);

const join = (type: string) => (tableRef: SQL.Part) => ({
  on: (...parts: SQL.Part[]) =>
    sql(unsafe(type), unsafe("join"), tableRef, unsafe("on"), ...parts),
});

export const innerJoin = join("inner");
export const leftJoin = join("left");
export const fullJoin = join("full");
export const crossJoin = join("cross");
export const naturalJoin = join("natural");

export const where = (...parts: SQL.Part[]) => {
  const tokens = tokenize(parts);
  if (tokens.length) {
    return sql(unsafe("where"), ...parts);
  }
};

export const orderBy = (...parts: SQL.Part[]) => {
  const tokens = tokenize(parts);
  if (tokens.length) {
    return sql(unsafe("order by"), ...parts);
  }
};
