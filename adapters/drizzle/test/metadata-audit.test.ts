import { toDrizzleSchema } from "@qubu/drizzle/postgres"
import { identityColumn, integer, schema, table } from "qubu"
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
