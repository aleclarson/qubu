import assert from "node:assert/strict";
import { Client } from "pg";
import {
  eq,
  execute,
  from,
  insertInto,
  integer,
  postgresDialect,
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
  readPostgresCatalog,
  type CatalogConnection,
  type CatalogQuery,
  type CatalogQueryRow,
} from "qubu/introspection";
import type { VerificationContext } from "../../contract.js";

const records = table("qubu_combo_pg_records", {
  id: integer(),
  name: text(),
});

const createTableSql = `
  CREATE TABLE qubu_combo_pg_records (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
  )
`;

const dropTableSql = "DROP TABLE IF EXISTS qubu_combo_pg_records";

export async function verify(context: VerificationContext): Promise<void> {
  const client = context.database.connection as Client;
  const dialect = postgresDialect();
  let lastStatement: RenderedQuery | undefined;
  const adapter: QueryAdapter = {
    dialect,
    async execute<TRow extends object>(statement: RenderedQuery) {
      lastStatement = statement;
      const result = await client.query(statement.text, [...statement.parameters]);
      return result.rows as unknown as readonly TRow[];
    },
  };

  const catalog: CatalogConnection = {
    dialect: "postgresql",
    async query<TRow extends CatalogQueryRow = CatalogQueryRow>(statement: CatalogQuery) {
      const result = await client.query(statement.text, [...statement.parameters]);
      return result.rows as readonly TRow[];
    },
  };

  await client.query(dropTableSql);
  await client.query(createTableSql);
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

    const normalized = await readPostgresCatalog(catalog, { namespace: "public" });
    assert.deepEqual(
      normalized.diagnostics.filter((issue) => issue.severity === "error"),
      [],
    );
    assert.ok(
      normalized.tables.some((table) => table.physicalName === "qubu_combo_pg_records"),
    );
  } finally {
    await client.query(dropTableSql);
  }
}
