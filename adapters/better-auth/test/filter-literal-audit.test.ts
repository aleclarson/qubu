import { DatabaseSync } from "node:sqlite"

import { nodeSqliteAdapter } from "@qubu/adapter-node-sqlite"
import { qubuAdapter } from "@qubu/better-auth"
import { qubu } from "qubu"
import { expect, test } from "vitest"

test.each([
  {
    operator: "contains",
    matching: "before%_!after",
    unrelated: "beforeab!after",
  },
  {
    operator: "starts_with",
    matching: "%_!after",
    unrelated: "ab!after",
  },
  {
    operator: "ends_with",
    matching: "before%_!",
    unrelated: "beforeab!",
  },
] as const)(
  "treats wildcard characters literally in $operator reads and updates",
  async ({ operator, matching, unrelated }) => {
    const database = new DatabaseSync(":memory:")

    try {
      database.exec(`
      CREATE TABLE "user" (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `)
      const insert = database.prepare('INSERT INTO "user" VALUES (?, ?, ?)')

      insert.run("matched", matching, "2026-10-22T12:00:00.000Z")
      insert.run("unrelated", unrelated, "2026-10-22T12:00:00.000Z")
      const adapter = qubuAdapter(qubu(nodeSqliteAdapter(database)))({})
      const filter = {
        field: "name",
        operator,
        value: "%_!",
        mode: "insensitive" as const,
      }

      await expect(
        adapter.findMany({
          model: "user",
          select: ["id"],
          where: [filter],
        }),
      ).resolves.toEqual([{ id: "matched" }])
      await expect(
        adapter.updateMany({
          model: "user",
          where: [filter],
          update: { name: "changed" },
        }),
      ).resolves.toBe(1)
      expect(database.prepare('SELECT id, name FROM "user" ORDER BY id').all()).toEqual([
        {
          id: "matched",
          name: "changed",
        },
        {
          id: "unrelated",
          name: unrelated,
        },
      ])
    } finally {
      database.close()
    }
  },
)
