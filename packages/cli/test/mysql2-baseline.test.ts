import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { SchemaSnapshot } from "qubu/snapshot"
import { expect, test, vi } from "vitest"

import type { Mysql2Connection } from "../../../adapters/mysql2/src/index.ts"
import { baselineAdapter, readMigrationSnapshot } from "../../../adapters/mysql2/src/migration.ts"
import {
  mysqlServerQuery,
  mysqlTablesQuery,
  mysqlColumnsQuery,
} from "../../../src/introspection/mysql.ts"
import { runCli } from "../src/cli.ts"
import type { QubuCliConfig } from "../src/config.ts"
import { FileArtifactRepository } from "../src/repository.ts"

function fixture() {
  const names = ["game", "external", "__qubu_mysql2_migrations", "__qubu_migration_metadata"]
  const rows: Record<string, Record<string, unknown>[]> = {
    [mysqlServerQuery]: [
      {
        version: "8.4.0",
        version_comment: "MySQL Community Server",
      },
    ],
    [mysqlTablesQuery]: names.map((table_name) => ({
      table_name,
      table_type: "BASE TABLE",
      engine: "InnoDB",
      table_collation: "utf8mb4_0900_ai_ci",
      create_options: "",
      table_comment: "table comment",
    })),
    [mysqlColumnsQuery]: names.map((table_name) => ({
      table_name,
      column_name: "id",
      ordinal_position: 1,
      column_type: "int",
      data_type: "int",
      is_nullable: "NO",
      column_default: null,
      extra: "",
      generation_expression: "",
      character_set_name: null,
      collation_name: null,
      column_comment: "id comment",
    })),
  }
  const history: unknown[][] = []
  const execute = vi.fn<Mysql2Connection["execute"]>(async ({ sql, values }) => {
    if (sql === "SELECT DATABASE() AS namespace") {
      return [[{ namespace: "games" }], []]
    }

    if (sql === "SELECT id FROM __qubu_mysql2_migrations") {
      return [history.map(([id]) => ({ id })), []]
    }

    if (sql.startsWith("INSERT INTO __qubu_mysql2_migrations")) {
      history.push(values)
    }

    if (
      sql.startsWith("CREATE TABLE") ||
      sql.startsWith("INSERT INTO") ||
      sql.startsWith("ALTER TABLE")
    ) {
      return [{ affectedRows: 1 }, []]
    }

    return [rows[sql] ?? [], []]
  })
  const connection = { execute }

  async function scope(): Promise<SchemaSnapshot> {
    const { snapshot } = await readMigrationSnapshot(connection)

    return {
      ...snapshot,
      comments: [],
      triggers: [],
      tables: snapshot.tables.filter((table) => table.physicalName === "game"),
    }
  }

  return {
    rows,
    history,
    execute,
    connection,
    scope,
  }
}

test("adopts MySQL through the shared CLI with an adoption-only adapter", async () => {
  const f = fixture()
  const cwd = await mkdtemp(join(tmpdir(), "qubu-mysql-adoption-"))
  const config: QubuCliConfig = {
    artifacts: "migrations",
    snapshot: await f.scope(),
    adapter: () => baselineAdapter(f.connection),
    environment: "test",
  }
  const run = async (args: string[]) => {
    const output: string[] = []
    const exit = await runCli(["migrate", ...args, "--format", "json"], {
      cwd,
      loadConfig: async () => config,
      stdout: (text) => output.push(text),
      stderr: (text) => output.push(text),
    })

    return {
      exit,
      output: output.join(""),
    }
  }

  try {
    expect((await run(["baseline-capture", "--out", "candidate.json"])).exit).toBe(0)
    expect(
      (await run(["baseline", "initial", "--candidate", "candidate.json", "--dry-run"])).exit,
    ).toBe(0)
    expect(f.history).toEqual([])
    const flags = [
      "database-target",
      "snapshot-source",
      "zero-managed-drift",
      "backup-restore-ready",
      "other-migrators-stopped",
      "incompatible-application-prevented",
      "legacy-history-cutover",
    ].flatMap((fact) => ["--confirm", fact])
    const accepted = await run([
      "baseline",
      "initial",
      "--candidate",
      "candidate.json",
      ...flags,
      "--non-interactive",
    ])

    expect(accepted.exit, accepted.output).toBe(0)
    const repository = new FileArtifactRepository("migrations", cwd)
    const [saved] = await repository.list()

    expect(JSON.parse(saved!)).toEqual(JSON.parse(f.history[0]![3] as string))
    const execution = await run(["apply", "--non-interactive"])

    expect(execution.exit).not.toBe(0)
    expect(execution.output).toContain("supports only schema adoption")
    expect(f.history).toHaveLength(1)
  } finally {
    await rm(cwd, {
      recursive: true,
      force: true,
    })
  }
})
