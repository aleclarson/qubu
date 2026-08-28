import { expect, test } from "vitest"

import {
  and,
  check,
  foreignKey,
  generatedColumn,
  index,
  integer,
  references,
  schema,
  table,
  text,
  unique,
  uniqueConstraint,
  value,
} from "../src/index.ts"
import { defineSchemaExpression, unsafeSchemaSql } from "../src/schema/index.ts"
import {
  createSchemaSnapshot,
  decodeSchemaSnapshot,
  encodeSchemaSnapshot,
  postgresSchemaDialect,
  schemaSnapshotDigest,
  sqliteSchemaDialect,
} from "../src/snapshot/index.ts"

const accounts = table(
  "accounts",
  {
    id: integer(),
    email: text({
      nullable: true,
      default: "pending",
    }),
    display: text({
      generatedColumn: generatedColumn(value("display"), "virtual"),
    }),
  },
  (table) => ({
    constraints: {
      accountPrimary: unique(table.id),
      emailConstraint: uniqueConstraint(table.email, { nulls: "not-distinct" }),
      displayCheck: check(and(value(true), value(true))),
    },
    indexes: {
      emailIndex: index([table.email], { unique: true }),
    },
  }),
)

const memberships = table(
  "memberships",
  {
    accountId: integer(),
    role: text({
      default: defineSchemaExpression("function", (context) => context.append("'member'")),
    }),
  },
  (table) => ({
    constraints: {
      accountForeign: foreignKey([table.accountId], references(accounts, accounts.id), {
        onDelete: "cascade",
      }),
    },
    indexes: {},
  }),
)

const appSchema = schema(
  {
    memberships,
    accounts,
  },
  { namespace: "public" },
)

test("serializes the complete neutral table model without executable values", () => {
  const snapshot = createSchemaSnapshot(appSchema)

  expect(snapshot).toMatchObject({
    format: "qubu-schema",
    version: 1,
    dialect: {
      name: "neutral",
      version: 1,
    },
    namingPolicy: {
      name: "snake-case",
      version: 1,
    },
    namespace: "public",
  })
  expect(snapshot.tables.map((table) => table.id)).toEqual(["accounts", "memberships"])
  expect(snapshot.tables[0]?.columns.map((column) => column.id)).toEqual(["display", "email", "id"])
  expect(snapshot.tables[0]?.columns[1]).toMatchObject({
    id: "email",
    physicalName: "email",
    nullable: true,
    hasDefault: true,
    default: {
      kind: "literal",
      value: {
        kind: "string",
        value: "pending",
      },
    },
  })
  expect(snapshot.tables[1]?.constraints[0]).toMatchObject({
    kind: "foreign-key",
    target: {
      table: "accounts",
      columns: ["id"],
    },
    onDelete: "cascade",
  })
  expect(snapshot.tables[0]?.constraints.map((constraint) => constraint.id)).toEqual([
    "accountPrimary",
    "displayCheck",
    "emailConstraint",
  ])
  expect(Object.isFrozen(snapshot)).toBe(true)
  expect(Object.isFrozen(snapshot.tables[0])).toBe(true)
})

test("retains custom schema naming policy identity beside materialized names", () => {
  const custom = schema(
    { accounts },
    {
      namingPolicy: {
        version: 1,
        tableName: (id) => `tenant_${id}`,
      },
    },
  )
  const snapshot = createSchemaSnapshot(custom)

  expect(snapshot.namingPolicy).toEqual({
    name: "custom",
    version: 1,
  })
  expect(snapshot.tables[0]).toMatchObject({
    id: "accounts",
    physicalName: "accounts",
  })
})

test("canonicalizes registry and metadata declaration order", () => {
  const reordered = schema(
    {
      accounts,
      memberships,
    },
    { namespace: "public" },
  )
  const first = encodeSchemaSnapshot(createSchemaSnapshot(appSchema))
  const second = encodeSchemaSnapshot(createSchemaSnapshot(reordered))

  expect(second).toBe(first)
  expect(schemaSnapshotDigest(first)).toBe(schemaSnapshotDigest(second))
})

test("digests canonical content rather than JSON presentation", () => {
  const encoded = encodeSchemaSnapshot(createSchemaSnapshot(appSchema))
  const parsed = JSON.parse(encoded) as Record<string, unknown>
  const reordered = JSON.stringify({
    tables: parsed.tables,
    namespace: parsed.namespace,
    namingPolicy: parsed.namingPolicy,
    dialect: parsed.dialect,
    version: parsed.version,
    format: parsed.format,
  })

  expect(schemaSnapshotDigest(reordered)).toBe(schemaSnapshotDigest(encoded))
})

test("round trips immutable data and rejects unknown or future fields", () => {
  const encoded = encodeSchemaSnapshot(createSchemaSnapshot(appSchema))
  const decoded = decodeSchemaSnapshot(encoded)

  expect(decoded.ok).toBe(true)
  if (decoded.ok) {
    expect(encodeSchemaSnapshot(decoded.value)).toBe(encoded)
    expect(Object.isFrozen(decoded.value.tables[0])).toBe(true)
  }

  const unknown = JSON.parse(encoded) as Record<string, unknown>

  unknown.unexpected = true
  const unknownResult = decodeSchemaSnapshot(unknown)

  expect(unknownResult.ok).toBe(false)
  if (!unknownResult.ok) {
    expect(unknownResult.diagnostics[0]?.code).toBe("unknown-field")
  }

  const future = JSON.parse(encoded) as Record<string, unknown>

  future.version = 2
  const futureResult = decodeSchemaSnapshot(future)

  expect(futureResult.ok).toBe(false)
  if (!futureResult.ok) {
    expect(futureResult.diagnostics[0]?.code).toBe("future-version")
  }
})

test("reports broken foreign-key references as structured diagnostics", () => {
  const encoded = encodeSchemaSnapshot(createSchemaSnapshot(appSchema))
  const malformed = JSON.parse(encoded) as {
    tables: Array<{
      constraints: Array<{
        kind: string
        target?: { table: string }
      }>
    }>
  }
  const foreign = malformed.tables[1]?.constraints[0]

  if (foreign?.kind === "foreign-key" && foreign.target) {
    foreign.target.table = "missing"
  }

  const result = decodeSchemaSnapshot(malformed)

  expect(result.ok).toBe(false)
  if (!result.ok) {
    expect(result.diagnostics.some((issue) => issue.code === "invalid-cross-reference")).toBe(true)
  }
})

test("rejects native storage owned by another snapshot dialect", () => {
  const encoded = encodeSchemaSnapshot(createSchemaSnapshot(appSchema))
  const malformed = JSON.parse(encoded) as {
    tables: Array<{
      columns: Array<{ storage?: unknown }>
    }>
  }
  const firstColumn = malformed.tables[0]?.columns[0]

  if (firstColumn) {
    firstColumn.storage = {
      kind: "native",
      dialect: "postgresql",
      type: "INTEGER",
    }
  }

  const result = decodeSchemaSnapshot(malformed)

  expect(result.ok).toBe(false)
  if (!result.ok) {
    expect(result.diagnostics.some((issue) => issue.code === "dialect-mismatch")).toBe(true)
  }
})

test("requires the selected dialect for unsafe schema SQL", () => {
  const unsafe = table("unsafe_defaults", {
    value: text({
      default: unsafeSchemaSql("postgresql", "CURRENT_DATE"),
    }),
  })

  expect(() => createSchemaSnapshot(schema({ unsafe }))).toThrow(/snapshot dialect/)
  expect(() =>
    createSchemaSnapshot(schema({ unsafe }), {
      dialect: sqliteSchemaDialect,
    }),
  ).toThrow(/schema dialect/)
  const postgres = createSchemaSnapshot(schema({ unsafe }), {
    dialect: postgresSchemaDialect,
  })

  expect(postgres.tables[0]?.columns[0]?.default).toMatchObject({
    kind: "expression",
    expression: {
      dialect: "postgresql",
      sql: "CURRENT_DATE",
    },
  })
})
