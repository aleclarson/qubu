import { encodeSchemaSnapshot, type SchemaSnapshot } from "qubu/snapshot"
import { expect, test, vi } from "vitest"

import type { Mysql2Connection } from "../adapters/mysql2/src/index.ts"
import {
  captureBaseline,
  createBaseline,
  migrate,
  preflightBaseline,
  readMigrationSnapshot,
  type CreateBaselineInput,
} from "../adapters/mysql2/src/migration.ts"
import { decodeBaselineArtifact } from "../packages/migrate/src/artifact/index.ts"
import {
  mysqlColumnsQuery,
  mysqlKeyUsageQuery,
  mysqlServerQuery,
  mysqlTablesQuery,
  mysqlTriggersQuery,
} from "../src/introspection/mysql.ts"

const confirmation: CreateBaselineInput["confirmation"] = {
  databaseTargetVerified: true,
  snapshotSourceVerified: true,
  zeroManagedDriftVerified: true,
  backupRestoreReady: true,
  otherMigratorsStopped: true,
  incompatibleApplicationPrevented: true,
  legacyHistoryCutoverAccepted: true,
}

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

test("captures live MySQL facts without filling desired columns or missing tables", async () => {
  const { connection, scope, execute } = fixture()
  const existing = await scope()
  const game = existing.tables[0]!
  const desired: SchemaSnapshot = {
    ...existing,
    comments: [],
    tables: [
      {
        ...game,
        id: "games",
        columns: [
          {
            ...game.columns[0]!,
            id: "identifier",
          },
          {
            ...game.columns[0]!,
            id: "manifest",
            physicalName: "manifest",
            ordinalPosition: 2,
          },
        ],
      },
      {
        ...game,
        id: "missing",
        physicalName: "missing",
      },
    ],
  }
  const captured = await captureBaseline(connection, { scope: desired })

  expect(captured.snapshot.tables.map((table) => table.id)).toEqual(["games"])
  expect(captured.snapshot.tables[0]!.columns.map((column) => column.id)).toEqual(["identifier"])
  expect(captured.unmanagedObjects).toEqual([
    {
      kind: "table",
      physicalName: "external",
    },
  ])
  expect(encodeSchemaSnapshot(captured.snapshot)).not.toContain("__qubu_")
  expect(captured.snapshot.comments.find((item) => item.physicalName === "id")?.object).toEqual({
    kind: "column",
    id: "identifier",
    owner: {
      kind: "table",
      id: "games",
    },
  })
  expect(
    execute.mock.calls.filter(([{ sql }]) => sql.startsWith("INSERT") || sql.startsWith("ALTER")),
  ).toEqual([])
})

test("rechecks reviewed candidates without writing history and records an accepted baseline before later SQL migrations", async () => {
  const f = fixture()
  const scope = await f.scope()
  const { snapshot: candidate } = await captureBaseline(f.connection, { scope })
  const input = {
    scope,
    candidate,
    migrations: [],
  }

  await preflightBaseline(f.connection, input)
  expect(f.history).toEqual([])
  const result = await createBaseline(f.connection, {
    ...input,
    id: "initial",
    confirmation,
    provenance: { source: "reviewed-catalog" },
    verifiedAt: "2026-09-08T12:00:00.000Z",
  })

  expect(result.artifact).toMatchObject({
    sequence: 0,
    parentArtifactDigest: null,
    snapshot: { value: candidate },
  })
  expect(result.artifact).not.toHaveProperty("program")
  expect(f.history).toHaveLength(1)
  const decoded = await decodeBaselineArtifact(f.history[0]![3] as string)

  expect(decoded.ok).toBe(true)
  if (decoded.ok) {
    expect(decoded.value).toEqual(result.artifact)
  }

  expect(f.history[0]!.slice(0, 3)).toEqual([
    "initial",
    result.artifact.artifactDigest.slice(7),
    Date.parse("2026-09-08T12:00:00.000Z"),
  ])
  const sql = [
    {
      id: "add-manifest",
      sql: ["ALTER TABLE game ADD manifest JSON"],
    },
  ]

  expect(await migrate(f.connection, sql)).toEqual({ applied: ["add-manifest"] })
  expect(await migrate(f.connection, sql)).toEqual({ applied: [] })
  expect(f.history.map(([id]) => id)).toEqual(["initial", "add-manifest"])
  await expect(
    createBaseline(f.connection, {
      ...input,
      id: "again",
      confirmation,
      provenance: { source: "test" },
    }),
  ).rejects.toMatchObject({ code: "policy" })
})

test("rejects changed live facts, changed metadata, and newly appeared managed tables", async () => {
  const f = fixture()
  const initial = await f.scope()
  const scope = {
    ...initial,
    tables: [
      ...initial.tables,
      {
        ...initial.tables[0]!,
        id: "missing",
        physicalName: "missing",
      },
    ],
  }
  const { snapshot: candidate } = await captureBaseline(f.connection, { scope })
  const input = {
    scope,
    candidate,
    migrations: [],
  }

  f.rows[mysqlColumnsQuery]![0]!.is_nullable = "YES"
  await expect(preflightBaseline(f.connection, input)).rejects.toMatchObject({
    code: "drift",
    details: { actualSnapshot: expect.any(Object) },
  })
  f.rows[mysqlColumnsQuery]![0]!.is_nullable = "NO"
  f.rows[mysqlTablesQuery]![0]!.table_comment = "edited"
  await expect(preflightBaseline(f.connection, input)).rejects.toMatchObject({ code: "drift" })
  f.rows[mysqlTablesQuery]![0]!.table_comment = "table comment"
  f.rows[mysqlTablesQuery]!.push({
    ...f.rows[mysqlTablesQuery]![0],
    table_name: "missing",
  })
  f.rows[mysqlColumnsQuery]!.push({
    ...f.rows[mysqlColumnsQuery]![0],
    table_name: "missing",
  })
  await expect(preflightBaseline(f.connection, input)).rejects.toMatchObject({ code: "drift" })
  expect(f.history).toEqual([])
})

test("rejects pending SQL, nonempty history, and candidates outside the original scope", async () => {
  const f = fixture()
  const scope = await f.scope()
  const candidate = (await captureBaseline(f.connection, { scope })).snapshot

  await expect(
    preflightBaseline(f.connection, {
      scope,
      candidate,
      migrations: [
        {
          id: "pending",
          sql: [],
        },
      ],
    }),
  ).rejects.toMatchObject({ code: "policy" })
  await expect(
    preflightBaseline(f.connection, {
      scope: {
        ...scope,
        tables: [],
      },
      candidate,
      migrations: [],
    }),
  ).rejects.toMatchObject({ code: "policy" })
  f.history.push(["old"])
  await expect(
    preflightBaseline(f.connection, {
      scope,
      candidate,
      migrations: [],
    }),
  ).rejects.toMatchObject({ code: "policy" })
})

test("requires every acknowledgment before accepting", async () => {
  const f = fixture()
  const scope = await f.scope()
  const input = {
    scope,
    candidate: scope,
    migrations: [],
    id: "initial",
    provenance: { source: "test" },
  }

  f.execute.mockClear()
  for (const key of Object.keys(confirmation)) {
    await expect(
      createBaseline(f.connection, {
        ...input,
        confirmation: {
          ...confirmation,
          [key]: false,
        },
      }),
    ).rejects.toMatchObject({ code: "policy" })
  }

  expect(f.execute).not.toHaveBeenCalled()
})

test("fails before journal writes for a mismatched database or dialect", async () => {
  const f = fixture()
  const scope = await f.scope()

  f.execute.mockClear()
  await expect(
    captureBaseline(f.connection, {
      scope: {
        ...scope,
        namespace: {
          ...scope.namespace,
          name: "other",
        },
      },
    }),
  ).rejects.toMatchObject({ code: "policy" })
  expect(f.execute.mock.calls.some(([{ sql }]) => sql.startsWith("CREATE"))).toBe(false)
  await expect(
    captureBaseline(f.connection, {
      scope: {
        ...scope,
        dialect: {
          name: "postgresql",
          version: 1,
        },
      },
    }),
  ).rejects.toThrow()
})

test("preserves strict catalog errors and rejects unresolved managed references", async () => {
  const f = fixture()
  const scope = await f.scope()
  const original = f.execute.getMockImplementation()!

  f.execute.mockImplementation(async (options) => {
    if (options.sql === mysqlColumnsQuery) {
      throw new Error("password=secret")
    }

    return original(options)
  })
  await expect(captureBaseline(f.connection, { scope })).rejects.toMatchObject({
    code: "validation",
    message: "Strict MySQL introspection failed",
  })
  f.execute.mockImplementation(original)
  f.rows[mysqlKeyUsageQuery] = [
    {
      table_name: "game",
      constraint_name: "external_fk",
      constraint_type: "FOREIGN KEY",
      column_name: "id",
      ordinal_position: 1,
      referenced_table_name: "external",
      referenced_column_name: "id",
      update_rule: "NO ACTION",
      delete_rule: "NO ACTION",
      match_option: "NONE",
    },
  ]
  await expect(captureBaseline(f.connection, { scope })).rejects.toMatchObject({
    code: "validation",
  })
})

test("excludes unmanaged table triggers and their comments", async () => {
  const f = fixture()

  f.rows[mysqlTriggersQuery] = [
    {
      trigger_name: "external_trigger",
      event_manipulation: "INSERT",
      table_name: "external",
      action_statement: "SET NEW.id = 1",
      action_orientation: "ROW",
      action_timing: "BEFORE",
      action_order: 1,
      definer: "app@localhost",
      sql_mode: "",
    },
  ]
  const scope = await f.scope()
  const { snapshot } = await captureBaseline(f.connection, { scope })

  expect(snapshot.triggers).toEqual([])
  expect(snapshot.comments.some((item) => item.object.owner?.id === "external")).toBe(false)
})

test("propagates a lost baseline insert response without claiming rollback or retrying", async () => {
  const f = fixture()
  const scope = await f.scope()
  const candidate = (await captureBaseline(f.connection, { scope })).snapshot
  const original = f.execute.getMockImplementation()!

  f.execute.mockImplementation(async (options) => {
    const result = await original(options)

    if (options.sql.includes("created_at, baseline)")) {
      throw new Error("connection lost")
    }

    return result
  })
  await expect(
    createBaseline(f.connection, {
      scope,
      candidate,
      migrations: [],
      id: "initial",
      provenance: { source: "test" },
      confirmation,
    }),
  ).rejects.toThrow("connection lost")
  expect(f.history).toHaveLength(1)
  expect(f.execute.mock.calls.some(([{ sql }]) => sql === "ROLLBACK")).toBe(false)
})
