import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  eq,
  execute,
  from,
  insertInto,
  integer,
  select,
  sqliteDialect,
  table,
  text,
  update,
  values,
  where,
  type QueryAdapter,
  type RenderedQuery,
} from "qubu";
import type { VerificationContext } from "../../contract.js";

const records = table("qubu_combo_node_sqlite_records", {
  id: integer(),
  name: text(),
});

const createTableSql = `
  CREATE TABLE qubu_combo_node_sqlite_records (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
  )
`;

const dropTableSql = "DROP TABLE IF EXISTS qubu_combo_node_sqlite_records";

export async function verify(context: VerificationContext): Promise<void> {
  const database = context.database.connection as DatabaseSync;
  const dialect = sqliteDialect();
  let lastStatement: RenderedQuery | undefined;
  const adapter: QueryAdapter = {
    dialect,
    async execute<TRow extends object>(statement: RenderedQuery) {
      lastStatement = statement;
      const prepared = database.prepare(statement.text);
      const parameters = statement.parameters as Array<
        string | number | bigint | Uint8Array | null
      >;
      if (/^\s*(SELECT|WITH|PRAGMA)/i.test(statement.text)) {
        return prepared
          .all(...parameters)
          .map((row) => ({ ...row })) as unknown as readonly TRow[];
      }
      prepared.run(...parameters);
      return [] as readonly TRow[];
    },
  };

  database.exec(dropTableSql);
  database.exec(createTableSql);
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
    assert.deepEqual(lastStatement?.parameters, [1]);
  } finally {
    database.exec(dropTableSql);
  }
}
