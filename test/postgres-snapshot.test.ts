import { expect, test } from "vitest"

import { postgresDialect } from "../src/dialects/postgres.ts"
import {
  boolean,
  check,
  desc,
  foreignKey,
  generatedColumn,
  index,
  integer,
  json,
  nativeColumn,
  primaryKey,
  references,
  schema,
  table,
  text,
  unique,
  uniqueConstraint,
  value,
  eq,
  gt,
} from "../src/index.ts"
import { unsafeSchemaSql } from "../src/schema/index.ts"
import { schemaSnapshotFingerprint } from "../src/snapshot/index.ts"
import {
  createSchemaSnapshot as createPostgresSchemaSnapshot,
  postgresSnapshotAdapter,
  tryCreateSchemaSnapshot as tryCreatePostgresSchemaSnapshot,
} from "../src/snapshot/postgres.ts"

const accounts = table(
  "account_records",
  {
    id: integer({
      identity: {
        kind: "identity",
        generation: "always",
      },
    }),
    email: text({ default: "pending" }),
    active: boolean({ default: true }),
    profile: json(),
    slug: text({
      generatedColumn: generatedColumn(value("account"), "stored"),
    }),
    handle: nativeColumn("postgresql", "CITEXT", { nullable: true }),
  },
  (account) => ({
    constraints: {
      primary: primaryKey(account.id, {
        physicalName: "account_records_pk",
      }),
      emailKey: unique(account.email, {
        physicalName: "account_records_email_key",
      }),
      emailConstraint: uniqueConstraint(account.email, {
        physicalName: "account_records_email_constraint",
        nulls: "distinct",
      }),
      positive: check(gt(account.id, value(0)), {
        physicalName: "account_records_positive",
        dialect: {
          dialect: "postgresql",
          notValid: true,
        },
      }),
    },
    indexes: {
      emailIndex: index([desc(account.email, "LAST")], {
        physicalName: "account_records_email_idx",
        include: [account.id],
        where: eq(account.active, value(true)),
        dialect: {
          dialect: "postgresql",
          method: "btree",
          concurrently: true,
          operatorClasses: { email: "text_ops" },
          storageParameters: { fillfactor: 90 },
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
        deferrable: true,
        initially: "deferred",
        dialect: {
          dialect: "postgresql",
          notValid: true,
        },
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

test("serializes PostgreSQL storage, behavior, constraints, indexes, and extensions", () => {
  const snapshot = createPostgresSchemaSnapshot(appSchema)
  const accountsTable = snapshot.tables.find((table) => table.id === "accounts")
  const membershipsTable = snapshot.tables.find((table) => table.id === "memberships")

  expect(snapshot.dialect).toEqual({
    name: "postgresql",
    version: 1,
  })
  expect(snapshot.namespace).toBe("public")
  expect(accountsTable?.columns).toEqual([
    {
      id: "active",
      physicalName: "active",
      nullable: false,
      hasDefault: true,
      generated: false,
      storage: {
        kind: "native",
        dialect: "postgresql",
        type: "BOOLEAN",
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
      nullable: false,
      hasDefault: true,
      generated: false,
      storage: {
        kind: "native",
        dialect: "postgresql",
        type: "TEXT",
      },
      default: {
        kind: "literal",
        value: {
          kind: "string",
          value: "pending",
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
        dialect: "postgresql",
        type: "CITEXT",
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
        dialect: "postgresql",
        type: "INTEGER",
      },
      identity: {
        kind: "identity",
        generation: "always",
      },
    },
    {
      id: "profile",
      physicalName: "profile",
      nullable: false,
      hasDefault: false,
      generated: false,
      storage: {
        kind: "native",
        dialect: "postgresql",
        type: "JSONB",
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
        dialect: "postgresql",
        type: "TEXT",
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
  expect(accountsTable?.constraints).toContainEqual(
    expect.objectContaining({
      id: "positive",
      kind: "check",
      physicalName: "account_records_positive",
      dialect: {
        dialect: "postgresql",
        version: 1,
        data: { notValid: true },
      },
    }),
  )
  expect(accountsTable?.indexes[0]).toMatchObject({
    id: "emailIndex",
    physicalName: "account_records_email_idx",
    includedColumns: ["id"],
    dialect: {
      dialect: "postgresql",
      version: 1,
      data: {
        concurrently: true,
        method: "btree",
        operatorClasses: { email: "text_ops" },
        storageParameters: { fillfactor: 90 },
      },
    },
  })
  expect(membershipsTable?.constraints[0]).toMatchObject({
    kind: "foreign-key",
    target: {
      table: "accounts",
      columns: ["id"],
    },
    deferrable: true,
    initially: "deferred",
  })
  expect(schemaSnapshotFingerprint(snapshot)).toMatch(/^fnv1a64:[0-9a-f]{16}$/)
})

test("keeps PostgreSQL canonical bytes independent of registry order", () => {
  const reordered = schema(
    {
      accounts,
      memberships,
    },
    { namespace: "public" },
  )
  const first = createPostgresSchemaSnapshot(appSchema)
  const second = createPostgresSchemaSnapshot(reordered)

  expect(JSON.stringify(first)).toBe(JSON.stringify(second))
  expect(schemaSnapshotFingerprint(first)).toBe(schemaSnapshotFingerprint(second))
})

test("shares query and snapshot dialect identity", () => {
  expect(postgresDialect().name).toBe("postgresql")
  expect(postgresSnapshotAdapter.dialect.name).toBe("postgresql")

  const raw = table("raw_defaults", {
    value: text({
      default: unsafeSchemaSql("postgresql", "CURRENT_DATE"),
    }),
  })

  expect(createPostgresSchemaSnapshot(schema({ raw })).tables[0]?.columns[0]).toMatchObject({
    default: {
      kind: "expression",
      expression: {
        dialect: "postgresql",
        sql: "CURRENT_DATE",
      },
    },
  })
})

test("reports PostgreSQL capability and naming diagnostics", () => {
  const virtual = table("virtual_values", {
    value: text({ generatedColumn: generatedColumn(value("x"), "virtual") }),
  })
  const nullable = table("nullable_values", { value: text({ nullable: true }) }, (table) => ({
    constraints: {
      valueConstraint: uniqueConstraint(table.value, {
        nulls: "not-distinct",
      }),
    },
    indexes: {},
  }))
  const first = table("first_values", { value: text() }, (table) => ({
    constraints: {},
    indexes: {
      shared: index([table.value], { physicalName: "shared_index" }),
    },
  }))
  const second = table("second_values", { value: text() }, (table) => ({
    constraints: {},
    indexes: {
      shared: index([table.value], { physicalName: "shared_index" }),
    },
  }))

  const result = tryCreatePostgresSchemaSnapshot(
    schema({
      virtual,
      nullable,
      first,
      second,
    }),
  )

  expect(result.ok).toBe(false)
  if (!result.ok) {
    expect(
      result.diagnostics.some(
        (issue) =>
          issue.code === "unsupported-dialect-option" && issue.path.includes("generatedColumn"),
      ),
    ).toBe(true)
    expect(
      result.diagnostics.some(
        (issue) => issue.code === "unsupported-dialect-option" && issue.path.includes("nulls"),
      ),
    ).toBe(true)
    expect(
      result.diagnostics.some((issue) =>
        issue.relatedPaths?.some((path) => path.includes("indexes")),
      ),
    ).toBe(true)
  }
})

test("rejects schema SQL tagged with another dialect name", () => {
  const raw = table("wrong_tag", {
    value: text({
      default: unsafeSchemaSql("postgres", "CURRENT_DATE"),
    }),
  })
  const result = tryCreatePostgresSchemaSnapshot(schema({ raw }))

  expect(result.ok).toBe(false)
  if (!result.ok) {
    expect(result.diagnostics.some((issue) => issue.code === "dialect-mismatch")).toBe(true)
  }
})
