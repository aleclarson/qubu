import assert from "node:assert/strict";
import postgres, { type Sql } from "postgres";
import type { QueryAdapter, RenderedQuery } from "qubu";
import type { VerificationContext } from "../../contract.js";
import { loadQubu } from "../native-qubu.js";

const createTableSql = `
  CREATE TABLE qubu_combo_postgresjs_records (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
  )
`;

const dropTableSql = "DROP TABLE IF EXISTS qubu_combo_postgresjs_records";

export async function verify(context: VerificationContext): Promise<void> {
  const connectionString = context.database.connectionString;
  if (!connectionString) {
    throw new Error("postgres.js scenario requires the runner's PostgreSQL connection string.");
  }

  const {
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
  } = await loadQubu(context);
  const records = table("qubu_combo_postgresjs_records", {
    id: integer(),
    name: text(),
  });
  const sql = postgres(connectionString, { max: 1 });
  let lastStatement: RenderedQuery | undefined;
  const adapter: QueryAdapter = {
    dialect: postgresDialect(),
    async execute<TRow extends object>(statement: RenderedQuery) {
      lastStatement = statement;
      const result = await (sql as Sql<Record<string, unknown>>).unsafe<TRow[]>(
        statement.text,
        [...statement.parameters] as never[],
      );
      return result.map((row) => ({ ...row })) as readonly TRow[];
    },
  };

  try {
    await sql.unsafe(dropTableSql);
    await sql.unsafe(createTableSql);

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
    await sql.unsafe(dropTableSql).catch(() => undefined);
    await sql.end({ timeout: 1 });
  }
}
