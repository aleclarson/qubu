import { DatabaseSync } from "node:sqlite"

import { nodeSqliteAdapter } from "@qubu/adapter-node-sqlite"
import { qubuAdapter } from "@qubu/better-auth"
import { qubu } from "qubu"
import { expect, test } from "vitest"

const patterns = [
  {
    operator: "contains",
    needle: "lic",
  },
  {
    operator: "starts_with",
    needle: "ali",
  },
  {
    operator: "ends_with",
    needle: "ice",
  },
] as const
const cases = patterns.flatMap((pattern) =>
  (["sensitive", "insensitive"] as const).map((mode) => ({
    ...pattern,
    mode,
  })),
)

function fixture() {
  const database = new DatabaseSync(":memory:")

  database.exec(`
    CREATE TABLE "user" (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO "user" VALUES ('u1', 'ALICE', '2026-10-22T12:00:00.000Z');
  `)
  const adapter = qubuAdapter(qubu(nodeSqliteAdapter(database)))({})

  return {
    database,
    adapter,
  }
}

test.each(cases)("honors $mode $operator filters on SQLite", async ({ operator, needle, mode }) => {
  const { database, adapter } = fixture()

  try {
    const rows = await adapter.findMany<{ id: string }>({
      model: "user",
      select: ["id"],
      where: [
        {
          field: "name",
          operator,
          value: needle,
          mode,
        },
      ],
    })

    expect(rows).toEqual(mode === "sensitive" ? [] : [{ id: "u1" }])
  } finally {
    database.close()
  }
})

test("excludes differently cased users from case-sensitive SQLite updates", async () => {
  const { database, adapter } = fixture()

  try {
    const changed = await adapter.updateMany({
      model: "user",
      where: [
        {
          field: "name",
          operator: "starts_with",
          value: "ali",
          mode: "sensitive",
        },
      ],
      update: { name: "changed" },
    })

    expect.soft(changed).toBe(0)
    expect(database.prepare('SELECT id, name FROM "user"').all()).toEqual([
      {
        id: "u1",
        name: "ALICE",
      },
    ])
  } finally {
    database.close()
  }
})
