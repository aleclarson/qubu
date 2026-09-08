import { createClient } from "@libsql/client"
import { expect, test } from "vitest"

import { readLibsqlMigrationSnapshot } from "../../adapters/libsql/src/migration.ts"
import type { SchemaSnapshot } from "../../src/snapshot/index.ts"

const sqlite = process.env.QUBU_E2E_DIALECT === "sqlite"

test.runIf(sqlite)(
  "captures actual SQLite facts without filling missing desired columns",
  async () => {
    const database = createClient({ url: ":memory:" })

    try {
      await database.execute(
        "CREATE TABLE qubu_baseline_game (id INTEGER PRIMARY KEY, title TEXT NOT NULL DEFAULT 'untitled')",
      )
      await database.execute("CREATE TABLE qubu_baseline_external (value TEXT)")
      const catalog = await readLibsqlMigrationSnapshot(database)
      const game = catalog.snapshot.tables.find(
        (table) => table.physicalName === "qubu_baseline_game",
      )!
      const scope: SchemaSnapshot = {
        ...catalog.snapshot,
        tables: [
          {
            ...game,
            columns: [
              ...game.columns,
              {
                ...game.columns[1]!,
                id: "manifest",
                physicalName: "manifest",
                ordinalPosition: 3,
              },
            ],
          },
        ],
      }
      const captured = await readLibsqlMigrationSnapshot(database, scope)

      expect(captured.snapshot.tables).toHaveLength(1)
      expect(captured.snapshot.tables[0]!.columns.map((column) => column.physicalName)).toEqual([
        "id",
        "title",
      ])
      expect(captured.snapshot.tables[0]!.columns[1]!.default).toEqual(game.columns[1]!.default)
      expect(captured.snapshot.tables[0]!.constraints).toEqual(game.constraints)
      expect(captured.unmanagedObjects).toEqual([
        {
          kind: "table",
          physicalName: "qubu_baseline_external",
        },
      ])
    } finally {
      database.close()
    }
  },
)
