import { ident, SQL } from "../core.ts";
import { PgColumn } from "./column.ts";

export function pgTable<Columns extends object>(
  tableName: string,
  columns: Columns & Record<string, PgColumn>
) {
  const table = new Proxy(new PgTable(tableName, columns), {
    get(table, key) {
      if (Object.prototype.hasOwnProperty.call(table[$columns], key)) {
        return table[$columns][key as string];
      }
      return table[key];
    },
  }) as PgTable<Columns> & Columns;

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

export class PgTable<Columns extends object> extends SQL {
  protected [$schemaName] = "public";
  protected [$tableName]: string;
  protected [$columns]: Columns;

  constructor(tableName: string, columns: Columns) {
    super(ident(tableName));
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
}
