import { DatabaseSync } from "node:sqlite"

import { nodeSqliteAdapter } from "@qubu/adapter-node-sqlite"
import { qubuAdapter } from "@qubu/better-auth"
import { qubu } from "qubu"
import { afterEach, expect, test } from "vitest"

let database: DatabaseSync | undefined

afterEach(() => database?.close())

test("executes guarded mutation and single-use consumption through SQLite", async () => {
  database = new DatabaseSync(":memory:")
  database.exec(`
    CREATE TABLE "user" (
      "id" TEXT PRIMARY KEY NOT NULL,
      "name" TEXT NOT NULL,
      "email" TEXT NOT NULL UNIQUE,
      "emailVerified" INTEGER NOT NULL,
      "image" TEXT,
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL,
      "remaining" INTEGER NOT NULL
    )
  `)
  const client = qubu(nodeSqliteAdapter(database))
  const adapter = qubuAdapter(client)({
    user: {
      additionalFields: {
        remaining: {
          type: "number",
          required: true,
        },
      },
    },
  })
  const now = new Date("2026-08-28T12:00:00.000Z")

  await adapter.create({
    model: "user",
    forceAllowId: true,
    data: {
      id: "u1",
      name: "Ada",
      email: "ada@example.com",
      emailVerified: false,
      image: null,
      createdAt: now,
      updatedAt: now,
      remaining: 1,
    },
  })

  const first = await adapter.incrementOne<{ remaining: number }>({
    model: "user",
    where: [
      {
        field: "id",
        value: "u1",
      },
      {
        field: "remaining",
        operator: "gt",
        value: 0,
      },
    ],
    increment: { remaining: -1 },
  })
  const guarded = await adapter.incrementOne({
    model: "user",
    where: [
      {
        field: "id",
        value: "u1",
      },
      {
        field: "remaining",
        operator: "gt",
        value: 0,
      },
    ],
    increment: { remaining: -1 },
  })
  const consumed = await adapter.consumeOne<{ id: string }>({
    model: "user",
    where: [
      {
        field: "id",
        value: "u1",
      },
    ],
  })
  const consumedAgain = await adapter.consumeOne({
    model: "user",
    where: [
      {
        field: "id",
        value: "u1",
      },
    ],
  })

  expect(first?.remaining).toBe(0)
  expect(guarded).toBeNull()
  expect(consumed?.id).toBe("u1")
  expect(consumedAgain).toBeNull()
})
