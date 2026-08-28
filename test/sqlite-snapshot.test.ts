import { expect, test } from "vitest"

import {
  boolean,
  check,
  foreignKey,
  generatedColumn,
  gt,
  identityColumn,
  index,
  integer,
  nativeColumn,
  primaryKey,
  references,
  schema,
  table,
  text,
  uniqueConstraint,
  value,
  eq,
} from "../src/index.ts"
import { unsafeSchemaSql } from "../src/schema/index.ts"
import {
  createSqliteSchemaSnapshot,
  decodeSchemaSnapshot,
  encodeSchemaSnapshot,
  schemaSnapshotDigest,
  sqliteSnapshotAdapter,
  sqliteStorageAffinity,
  tryCreateSqliteSchemaSnapshot,
} from "../src/snapshot/index.ts"

const accounts = table(
  "account_records",
  {
    id: integer({
      identity: identityColumn("by-default", {
        dialect: {
          dialect: "sqlite",
          autoIncrement: true,
        },
      }),
    }),
    email: text({
      nullable: true,
      default: "O'Reilly",
    }),
    active: boolean({ default: true }),
    slug: text({
      generatedColumn: generatedColumn(value("account"), "stored"),
    }),
    handle: nativeColumn("sqlite", "VARCHAR(255)", { nullable: true }),
  },
  (account) => ({
    constraints: {
      primary: primaryKey(account.id, { physicalName: "account_records_pk" }),
      positive: check(gt(account.id, value(0))),
      emailConstraint: uniqueConstraint(account.email, {
        nulls: "distinct",
      }),
    },
    indexes: {
      activeEmail: index([account.email], {
        physicalName: "account_records_active_email",
        where: eq(account.active, value(true)),
        dialect: {
          dialect: "sqlite",
          auto: true,
        },
      }),
    },
  }),
)

const memberships = table(
  "account_memberships",
  {
    accountId: integer(),
    role: text({ default: "member" }),
  },
  (membership) => ({
    constraints: {
      accountForeign: foreignKey([membership.accountId], references(accounts, accounts.id), {
        onDelete: "cascade",
        match: "simple",
        deferrable: true,
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
  { namespace: "main" },
)

test("serializes SQLite affinity, literals, generated columns, identities, and partial indexes", () => {
  const snapshot = createSqliteSchemaSnapshot(appSchema)
  const accountsTable = snapshot.tables.find((table) => table.id === "accounts")
  const membershipsTable = snapshot.tables.find((table) => table.id === "memberships")

  expect(snapshot.dialect).toEqual({
    name: "sqlite",
    version: 1,
  })
  expect(snapshot.namespace).toBe("main")
  expect(accountsTable?.columns).toEqual([
    {
      id: "active",
      physicalName: "active",
      nullable: false,
      hasDefault: true,
      generated: false,
      storage: {
        kind: "native",
        dialect: "sqlite",
        type: "INTEGER",
        affinity: "integer",
      },
      default: {
        kind: "literal",
        value: {
          kind: "boolean",
          value: true,
        },
      },
    },
    {
      id: "email",
      physicalName: "email",
      nullable: true,
      hasDefault: true,
      generated: false,
      storage: {
        kind: "native",
        dialect: "sqlite",
        type: "TEXT",
        affinity: "text",
      },
      default: {
        kind: "literal",
        value: {
          kind: "string",
          value: "O'Reilly",
        },
      },
    },
    {
      id: "handle",
      physicalName: "handle",
      nullable: true,
      hasDefault: false,
      generated: false,
      storage: {
        kind: "native",
        dialect: "sqlite",
        type: "VARCHAR(255)",
        affinity: "text",
      },
    },
    {
      id: "id",
      physicalName: "id",
      nullable: false,
      hasDefault: false,
      generated: true,
      storage: {
        kind: "native",
        dialect: "sqlite",
        type: "INTEGER",
        affinity: "integer",
      },
      identity: {
        kind: "identity",
        generation: "by-default",
        dialect: {
          dialect: "sqlite",
          version: 1,
          data: { autoIncrement: true },
        },
      },
    },
    {
      id: "slug",
      physicalName: "slug",
      nullable: false,
      hasDefault: false,
      generated: true,
      storage: {
        kind: "native",
        dialect: "sqlite",
        type: "TEXT",
        affinity: "text",
      },
      generatedColumn: {
        kind: "expression",
        expression: {
          kind: "expression",
          expressionKind: "value",
          sql: "'account'",
        },
        mode: "stored",
      },
    },
  ])
  expect(accountsTable?.indexes[0]).toMatchObject({
    id: "activeEmail",
    predicate: {
      kind: "expression",
      expressionKind: "operator",
      sql: '("active" = 1)',
    },
    dialect: {
      dialect: "sqlite",
      version: 1,
      data: { auto: true },
    },
  })
  expect(membershipsTable?.constraints[0]).toMatchObject({
    kind: "foreign-key",
    target: {
      table: "accounts",
      columns: ["id"],
    },
    onDelete: "cascade",
    match: "simple",
    deferrable: true,
  })
  expect(schemaSnapshotDigest(snapshot)).toMatch(/^fnv1a64:[0-9a-f]{16}$/)
})

test("keeps SQLite canonical bytes independent of registry and metadata order", () => {
  const reordered = schema(
    {
      accounts,
      memberships,
    },
    { namespace: "main" },
  )
  const first = encodeSchemaSnapshot(createSqliteSchemaSnapshot(appSchema))
  const second = encodeSchemaSnapshot(createSqliteSchemaSnapshot(reordered))

  expect(second).toBe(first)
  expect(schemaSnapshotDigest(first)).toBe(schemaSnapshotDigest(second))
})

test("records SQLite declared-type affinity while preserving exact native text", () => {
  expect(sqliteStorageAffinity("INTEGER")).toBe("integer")
  expect(sqliteStorageAffinity("VARCHAR(32)")).toBe("text")
  expect(sqliteStorageAffinity("DOUBLE PRECISION")).toBe("real")
  expect(sqliteStorageAffinity("BLOB")).toBe("blob")
  expect(sqliteStorageAffinity("DECIMAL(10, 2)")).toBe("numeric")

  const custom = table("custom_types", {
    value: nativeColumn("sqlite", "DOUBLE PRECISION"),
  })

  expect(createSqliteSchemaSnapshot(schema({ custom })).tables[0]?.columns[0]).toMatchObject({
    storage: {
      kind: "native",
      type: "DOUBLE PRECISION",
      affinity: "real",
    },
  })
})

test("round trips SQLite affinity and identity extension data through the strict decoder", () => {
  const snapshot = createSqliteSchemaSnapshot(appSchema)
  const decoded = decodeSchemaSnapshot(encodeSchemaSnapshot(snapshot))

  expect(decoded.ok).toBe(true)
  if (decoded.ok) {
    expect(decoded.value).toEqual(snapshot)
  }
})

test("keeps query and snapshot dialect identities separate", () => {
  expect(sqliteSnapshotAdapter.dialect.name).toBe("sqlite")

  const raw = table("raw_defaults", {
    value: text({
      default: unsafeSchemaSql("sqlite", "CURRENT_DATE\r\n"),
    }),
  })

  expect(createSqliteSchemaSnapshot(schema({ raw })).tables[0]?.columns[0]).toMatchObject({
    default: {
      kind: "expression",
      expression: {
        dialect: "sqlite",
        sql: "CURRENT_DATE\n",
      },
    },
  })
})

test("reports unsupported SQLite foreign-key, generated-column, and index combinations", () => {
  const parent = table("parent_values", { id: integer() }, (table) => ({
    constraints: { primary: primaryKey(table.id) },
    indexes: {},
  }))
  const invalidForeign = table("invalid_foreign", { parentId: integer() }, (row) => ({
    constraints: {
      parent: foreignKey([row.parentId], references(parent, parent.id), {
        match: "full",
      }),
    },
    indexes: {},
  }))
  const generatedPrimary = table(
    "generated_primary",
    {
      value: text({ generatedColumn: generatedColumn(value("x"), "virtual") }),
    },
    (row) => ({
      constraints: { primary: primaryKey(row.value) },
      indexes: {},
    }),
  )
  const included = table("included_index", { value: text() }, (row) => ({
    constraints: {},
    indexes: { value: index([row.value], { include: [row.value] }) },
  }))
  const badIdentity = table("bad_identity", {
    id: text({
      identity: identityColumn("by-default", {
        dialect: {
          dialect: "sqlite",
          autoIncrement: true,
        },
      }),
    }),
  })
  const notDistinct = table("not_distinct_values", { value: text({ nullable: true }) }, (row) => ({
    constraints: {
      valueKey: uniqueConstraint(row.value, { nulls: "not-distinct" }),
    },
    indexes: {},
  }))

  const result = tryCreateSqliteSchemaSnapshot(
    schema({
      parent,
      invalidForeign,
      generatedPrimary,
      included,
      badIdentity,
      notDistinct,
    }),
  )

  expect(result.ok).toBe(false)
  if (!result.ok) {
    expect(
      result.diagnostics.some(
        (issue) => issue.code === "unsupported-dialect-option" && issue.path.includes("match"),
      ),
    ).toBe(true)
    expect(
      result.diagnostics.some(
        (issue) =>
          issue.code === "unsupported-dialect-option" && issue.path.includes("generatedColumn"),
      ),
    ).toBe(true)
    expect(
      result.diagnostics.some(
        (issue) =>
          issue.code === "unsupported-dialect-option" && issue.path.includes("includedColumns"),
      ),
    ).toBe(true)
    expect(
      result.diagnostics.some(
        (issue) => issue.code === "unsupported-dialect-option" && issue.path.includes("identity"),
      ),
    ).toBe(true)
    expect(
      result.diagnostics.some(
        (issue) => issue.code === "unsupported-dialect-option" && issue.path.includes("nulls"),
      ),
    ).toBe(true)
  }
})

test("rejects native storage and unsafe SQL owned by another dialect", () => {
  const native = table("wrong_storage", {
    value: nativeColumn("postgresql", "TEXT"),
  })
  const wrongRaw = table("wrong_raw", {
    value: text({
      default: unsafeSchemaSql("postgresql", "CURRENT_DATE"),
    }),
  })
  const result = tryCreateSqliteSchemaSnapshot(
    schema({
      native,
      wrongRaw,
    }),
  )

  expect(result.ok).toBe(false)
  if (!result.ok) {
    expect(result.diagnostics.some((issue) => issue.code === "dialect-mismatch")).toBe(true)
  }
})
