import { toDrizzleSchema } from "@qubu/drizzle/postgres"
import { getTableConfig } from "drizzle-orm/pg-core"
import { identityColumn, index, integer, schema, table, text } from "qubu"
import { expect, test } from "vitest"

test("preserves PostgreSQL identity sequence options during Drizzle conversion", () => {
  const records = table("audit_identity_records", {
    id: integer({
      identity: identityColumn("always", {
        options: {
          start: 100,
          increment: 5,
        },
      }),
    }),
  })
  const converted = toDrizzleSchema(schema({ records }))

  expect(converted.records.id.generatedIdentity).toMatchObject({
    type: "always",
    sequenceOptions: {
      startWith: 100,
      increment: 5,
    },
  })
})

test("preserves the default PostgreSQL identity policy without sequence options", () => {
  const records = table("audit_default_identity_records", {
    id: integer({ identity: identityColumn("by-default") }),
  })
  const converted = toDrizzleSchema(schema({ records }))

  expect(converted.records.id.generatedIdentity).toEqual({ type: "byDefault" })
})

test.each([false, true])(
  "preserves the PostgreSQL index access method in Drizzle (extension metadata: %s)",
  (extension) => {
    const options = extension
      ? {
          dialect: {
            dialect: "postgresql" as const,
            method: "hash" as const,
          },
        }
      : { method: "hash" }
    const records = table("audit_index_method", { label: text() }, (columns) => ({
      constraints: {},
      indexes: { lookup: index([columns.label], options) },
    }))
    const converted = toDrizzleSchema(schema({ records }))

    expect(getTableConfig(converted.records).indexes[0]?.config.method).toBe("hash")
  },
)
