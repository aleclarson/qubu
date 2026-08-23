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
import type { VerificationContext } from "../../contract.js";

interface PGliteDatabase {
  exec(sql: string): Promise<unknown>;
  query<TRow extends object>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ rows: TRow[] }>;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertJson(actual: unknown, expected: unknown, message: string): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  assert(actualJson === expectedJson, `${message}: expected ${expectedJson}, got ${actualJson}`);
}

const tableName = "qubu_combo_pglite_records";
const createTableSql = `
  CREATE TABLE ${tableName} (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
  )
`;
const dropTableSql = `DROP TABLE IF EXISTS ${tableName}`;

/** Verify Qubu's PostgreSQL boundaries against PGlite running in Chromium. */
export async function verify(context: VerificationContext<PGliteDatabase>): Promise<void> {
  const database = context.database.connection;
  assert(database, "PGlite scenario requires the browser-created database.");

  const records = table(tableName, {
    id: integer(),
    name: text(),
  });
  let lastStatement: RenderedQuery | undefined;
  const adapter: QueryAdapter = {
    dialect: postgresDialect(),
    async execute<TRow extends object>(statement: RenderedQuery) {
      lastStatement = statement;
      const result = await database.query<TRow>(statement.text, [...statement.parameters]);
      return result.rows as readonly TRow[];
    },
  };

  await database.exec(dropTableSql);
  await database.exec(createTableSql);
  try {
    await execute(insertInto(records, values({ id: 1, name: "Ada" })), adapter);

    const selected = await execute(
      select(
        { id: records.id, name: records.name },
        from(records),
        where(eq(records.id, 1)),
      ),
      adapter,
    );
    assertJson(selected, [{ id: 1, name: "Ada" }], "PGlite selected row");
    assertJson(lastStatement?.parameters, [1], "PGlite bound value");

    await execute(update(records, { name: "Grace" }, where(eq(records.id, 1))), adapter);
    const mutated = await execute(
      select(
        { id: records.id, name: records.name },
        from(records),
        where(eq(records.id, 1)),
      ),
      adapter,
    );
    assertJson(mutated, [{ id: 1, name: "Grace" }], "PGlite mutated row");
  } finally {
    await database.exec(dropTableSql).catch(() => undefined);
  }
}
