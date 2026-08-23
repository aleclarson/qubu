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

interface D1PreparedStatement {
  bind(...values: readonly unknown[]): D1PreparedStatement;
  all<TRow extends Record<string, unknown>>(): Promise<{
    results: TRow[];
  }>;
  run(): Promise<unknown>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

const tableName = "qubu_combo_d1_records";
const createTableSql = `
  CREATE TABLE ${tableName} (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
  )
`;
const dropTableSql = `DROP TABLE IF EXISTS ${tableName}`;

/** Verify Qubu's SQLite boundaries against a real local D1 binding in workerd. */
export async function verify(context: VerificationContext<D1Database>): Promise<void> {
  const database = context.database.connection;
  assert(database, "D1 scenario requires the Worker-provided D1 binding.");

  const records = table(tableName, {
    id: integer(),
    name: text(),
  });
  let lastStatement: RenderedQuery | undefined;
  const adapter: QueryAdapter = {
    dialect: sqliteDialect(),
    async execute<TRow extends object>(statement: RenderedQuery) {
      lastStatement = statement;
      const bound = database.prepare(statement.text).bind(...statement.parameters);
      if (/^\s*(SELECT|WITH|PRAGMA)/i.test(statement.text)) {
        const result = await bound.all<Record<string, unknown>>();
        return result.results as readonly TRow[];
      }
      await bound.run();
      return [] as readonly TRow[];
    },
  };

  await database.prepare(dropTableSql).run();
  await database.prepare(createTableSql).run();
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
    assertEqual(JSON.stringify(selected), JSON.stringify([{ id: 1, name: "Ada" }]), "D1 selected row");
    assertEqual(JSON.stringify(lastStatement?.parameters), JSON.stringify([1]), "D1 bound value");

    await execute(update(records, { name: "Grace" }, where(eq(records.id, 1))), adapter);
    const mutated = await execute(
      select(
        { id: records.id, name: records.name },
        from(records),
        where(eq(records.id, 1)),
      ),
      adapter,
    );
    assertEqual(JSON.stringify(mutated), JSON.stringify([{ id: 1, name: "Grace" }]), "D1 mutated row");
  } finally {
    await database.prepare(dropTableSql).run().catch(() => undefined);
  }
}
