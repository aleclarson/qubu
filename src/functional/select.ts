import { comma, sequence, SQL, sql, unsafe } from "../core.ts";
import { ColumnName, ColumnType } from "../symbols.ts";
import { isColumnIdentifier } from "../tokens.ts";
import { isPlainObject } from "../util.ts";

export const select = <T extends (SQL.Part | Record<string, SQL.Part>)[]>(
  ...args: T
) => {
  const decoders: Record<string, (sqlType: unknown) => unknown> = {};
  const selected = args.map((arg) => {
    if (isPlainObject(arg)) {
      return sequence(
        Object.entries(arg).map(([alias, value]) => {
          if (isColumnIdentifier(value)) {
            decoders[alias] = value.context[ColumnType].decode;
            return alias === value.context[ColumnName]
              ? value
              : sql(value).as(alias);
          }
          if (value instanceof SQL && value.decode) {
            decoders[alias] = value.decode;
            return value.as(alias);
          }
          // No decoder found, so we'll just return the value as is.
          return sql(value).as(alias);
        }),
        comma
      );
    }
    // TODO: extract decoders
    return arg;
  });

  return sql(unsafe("select"), sequence(selected, comma)).mapWith((rows) => {
    const keys = Object.keys(decoders);
    return (rows as Record<string, unknown>[]).map((row) => {
      for (const key of keys) {
        if (row[key] != null) {
          row[key] = decoders[key](row[key]);
        }
      }
      return row;
    });
  });
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

export const where = (...parts: SQL.Part[]) => sql(unsafe("where"), ...parts);

export const orderBy = (...parts: SQL.Part[]) => {
  const tokens = tokenize(parts);
  if (tokens.length) {
    return sql(unsafe("order by"), ...parts);
  }
};
