import { ident, SQL } from "../core.ts";
import { Column } from "./column.ts";

export function pgTable<Columns extends object>(
  tableName: string,
  columns: Columns & Record<string, Column>
) {
  const table = new Proxy(new Table(tableName, columns), {
    get(table, key) {
      if (Object.prototype.hasOwnProperty.call(table[$columns], key)) {
        return table[$columns][key as string];
      }
      return table[key];
    },
  }) as TableWithColumns<Columns>;

  for (const key in columns) {
    columns[key].table = table;

    // Derive a column name, if not provided.
    columns[key].name ||= key.replace(/([A-Z])/g, "_$1").toLowerCase();
  }

  return table;
}

const $schemaName = Symbol.for("schemaName");
const $tableName = Symbol.for("tableName");
const $columns = Symbol.for("columns");

export class Table<Columns extends object> extends SQL {
  protected [$schemaName]: string | undefined;
  protected [$tableName]: string;
  protected [$columns]: Columns;

  constructor(tableName: string, columns: Columns, schemaName?: string) {
    super([ident(tableName)]);
    this[$schemaName] = schemaName;
    this[$tableName] = tableName;
    this[$columns] = columns;
  }

  getSchemaName() {
    return this[$schemaName];
  }
  getTableName() {
    return this[$tableName];
  }
  getTableColumns() {
    return this[$columns];
  }

  as(alias: string): TableWithColumns<Columns> {
    const table = new Table(alias, this[$columns]);
    table.tokens.push("as", ident(alias));
    return new Proxy(table, {
      get(table, key) {
        if (Object.prototype.hasOwnProperty.call(table[$columns], key)) {
          const column = Object.create(table[$columns][key as string]);
          column.table = table;
          return column;
        }
        return table[key];
      },
    }) as any;
  }
}

export type TableWithColumns<Columns extends object> = Table<Columns> & {
  [K in keyof Columns]: Columns[K] extends SQL<infer T> ? SQL<T> : never;
};
