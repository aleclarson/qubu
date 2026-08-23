import assert from "node:assert/strict";
import { type Connection, type RowDataPacket } from "mysql2/promise";
import {
  eq,
  execute,
  from,
  insertInto,
  integer,
  mysqlDialect,
  select,
  table,
  text,
  update,
  values,
  where,
  type QueryAdapter,
  type RenderedQuery,
} from "qubu";
import {
  readMysqlCatalog,
  type CatalogConnection,
  type CatalogQuery,
  type CatalogQueryRow,
} from "qubu/introspection";
import type { VerificationContext } from "../../contract.js";

const records = table("qubu_combo_mysql_records", {
  id: integer(),
  name: text(),
});

const createTableSql = `
  CREATE TABLE qubu_combo_mysql_records (
    id INTEGER PRIMARY KEY,
    name VARCHAR(255) NOT NULL
  )
`;

const dropTableSql = "DROP TABLE IF EXISTS qubu_combo_mysql_records";

export async function verify(context: VerificationContext): Promise<void> {
  const connection = context.database.connection as Connection;
  const dialect = mysqlDialect();
  let lastStatement: RenderedQuery | undefined;
  const adapter: QueryAdapter = {
    dialect,
    async execute<TRow extends object>(statement: RenderedQuery) {
      lastStatement = statement;
      const [rows] = await connection.execute(
        statement.text,
        statement.parameters as any[],
      );
      return (Array.isArray(rows) ? rows : []) as unknown as readonly TRow[];
    },
  };

  const catalog: CatalogConnection = {
    dialect: "mysql",
    async query<TRow extends CatalogQueryRow = CatalogQueryRow>(statement: CatalogQuery) {
      const [rows] = await connection.execute<RowDataPacket[]>(
        statement.text,
        statement.parameters as any[],
      );
      return (Array.isArray(rows) ? rows : []) as unknown as readonly TRow[];
    },
  };

  await connection.query(dropTableSql);
  await connection.query(createTableSql);
  try {
    await execute(
      insertInto(records, values({ id: 1, name: "Ada" })),
      adapter,
    );

    const selected = await execute(
      select({ id: records.id, name: records.name }, from(records), where(eq(records.id, 1))),
      adapter,
    );
    assert.deepEqual(selected, [{ id: 1, name: "Ada" }]);
    assert.deepEqual(lastStatement?.parameters, [1]);

    await execute(
      update(records, { name: "Grace" }, where(eq(records.id, 1))),
      adapter,
    );
    const mutated = await execute(
      select({ id: records.id, name: records.name }, from(records), where(eq(records.id, 1))),
      adapter,
    );
    assert.deepEqual(mutated, [{ id: 1, name: "Grace" }]);

    const normalized = await readMysqlCatalog(catalog, {
      namespace: context.database.metadata?.database ?? "qubu",
    });
    // MySQL 8.4 removed a few optional INFORMATION_SCHEMA columns used by
    // Qubu's view and routine readers. The table catalog remains available,
    // so assert the fixture that this scenario owns rather than weakening the
    // round-trip check for server-version diagnostics.
    assert.ok(
      normalized.tables.some(
        (table) => table.physicalName === "qubu_combo_mysql_records",
      ),
    );
  } finally {
    await connection.query(dropTableSql);
  }
}
