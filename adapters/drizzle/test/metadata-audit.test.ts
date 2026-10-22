import { DrizzleSchemaConversionError } from "@qubu/drizzle"
import { toDrizzleSchema as toMysqlDrizzleSchema } from "@qubu/drizzle/mysql"
import { toDrizzleSchema } from "@qubu/drizzle/postgres"
import { sql } from "drizzle-orm"
import { getTableConfig as getMysqlTableConfig, MySqlDialect } from "drizzle-orm/mysql-core"
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

test("preserves MySQL unique index prefixes or rejects unsupported conversion", () => {
  const records = table("audit_prefix_records", { label: text() }, (columns) => ({
    constraints: {},
    indexes: {
      prefix: index([columns.label], {
        unique: true,
        termOptions: [{ prefixLength: 8 }],
      }),
    },
  }))

  try {
    const converted = toMysqlDrizzleSchema(schema({ records }))
    const convertedIndex = getMysqlTableConfig(converted.records).indexes[0]

    expect(convertedIndex?.config.unique).toBe(true)
    const term = convertedIndex?.config.columns[0]

    expect(term).toBeDefined()
    const rendered = new MySqlDialect().sqlToQuery(sql`${term}`)

    expect(rendered.sql).toContain("`label`(8)")
    expect(rendered.params).toEqual([])
  } catch (error) {
    if (!(error instanceof DrizzleSchemaConversionError)) {
      throw error
    }

    expect(error.code).toBe("unsupported-metadata")
    expect(error.path).toContain("prefixLength")
  }
})
