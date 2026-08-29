import { diffSnapshots } from "qubu/diff"
import { postgresSchemaDialect, type SchemaSnapshot } from "qubu/snapshot"
import { expect, test } from "vitest"

import {
  emitMigrationPlan,
  emitMysqlMigrationPlan,
  emitPostgresMigrationPlan,
  emitSqliteMigrationPlan,
} from "../src/ddl/index.ts"
import { createMigrationPlan, type MigrationPlan } from "../src/plan/index.ts"

function snapshot(
  dialect: SchemaSnapshot["dialect"],
  tables: SchemaSnapshot["tables"],
): SchemaSnapshot {
  return {
    format: "qubu-schema",
    version: 1,
    dialect,
    namingPolicy: {
      name: "test",
      version: 1,
    },
    namespace: dialect.name === "sqlite" ? "main" : "public",
    tables,
  }
}

function table(id: string, columns: SchemaSnapshot["tables"][number]["columns"] = []) {
  return {
    id,
    physicalName: id,
    columns,
    constraints: [],
    indexes: [],
  }
}

function column(id: string) {
  return {
    id,
    physicalName: id,
    nullable: false,
    hasDefault: false,
    generated: false,
    storage: {
      kind: "portable" as const,
      type: "text",
    },
  }
}

function planFor(dialect: SchemaSnapshot["dialect"]): MigrationPlan {
  const result = createMigrationPlan(
    diffSnapshots(snapshot(dialect, []), snapshot(dialect, [table("accounts", [column("name")])])),
  )

  if (!result.ok) {
    throw new Error(result.diagnostics.map((item) => item.message).join("\n"))
  }

  return result.plan
}

test("emits deterministic table and column SQL for all first-party dialects", () => {
  const postgres = emitPostgresMigrationPlan(
    planFor({
      name: "postgresql",
      version: 1,
    }),
  )
  const sqlite = emitSqliteMigrationPlan(
    planFor({
      name: "sqlite",
      version: 1,
    }),
  )
  const mysql = emitMysqlMigrationPlan(
    planFor({
      name: "mysql",
      version: 1,
    }),
  )

  expect(postgres.ok).toBe(true)
  expect(postgres.statements).toHaveLength(1)
  expect(postgres.statements[0]?.sql).toBe(
    'CREATE TABLE "public"."accounts" ("name" TEXT NOT NULL)',
  )
  expect(sqlite.statements[0]?.sql).toBe('CREATE TABLE "main"."accounts" ("name" TEXT NOT NULL)')
  expect(mysql.statements[0]?.sql).toBe("CREATE TABLE `public`.`accounts` (`name` TEXT NOT NULL)")
  expect(postgres.parameters).toEqual([])
  expect(postgres.sql).toBe(`${postgres.statements[0]?.sql};`)
})

test("emits child constraints and indexes when a table is created", () => {
  const dialect = {
    name: "postgresql",
    version: 1,
  } as const
  const accounts = {
    ...table("accounts", [column("id"), column("name")]),
    constraints: [
      {
        id: "accounts_pk",
        kind: "primary-key" as const,
        physicalName: "accounts_pk",
        columns: ["id"],
      },
    ],
    indexes: [
      {
        id: "accounts_name_idx",
        kind: "index" as const,
        physicalName: "accounts_name_idx",
        terms: [
          {
            kind: "column" as const,
            column: "name",
          },
        ],
        unique: false,
        candidateKey: false,
      },
    ],
  }
  const planned = createMigrationPlan(
    diffSnapshots(snapshot(dialect, []), snapshot(dialect, [accounts])),
  )

  expect(planned.ok).toBe(true)
  if (!planned.ok) {
    return
  }

  const emission = emitPostgresMigrationPlan(planned.plan)

  expect(emission.ok).toBe(true)
  expect(emission.statements[0]?.kind).toBe("table")
  expect(emission.statements.slice(1).map((statement) => statement.kind)).toEqual(
    expect.arrayContaining(["constraint", "index"]),
  )
  expect(emission.sql).toContain(
    'ALTER TABLE "public"."accounts" ADD CONSTRAINT "accounts_pk" PRIMARY KEY ("id");',
  )
  expect(emission.sql).toContain(
    'CREATE INDEX "public"."accounts_name_idx" ON "public"."accounts" ("name");',
  )
})

test("rejects SQLite table constraints without a rebuild path", () => {
  const dialect = {
    name: "sqlite",
    version: 1,
  } as const
  const accounts = {
    ...table("accounts", [column("id")]),
    constraints: [
      {
        id: "accounts_pk",
        kind: "primary-key" as const,
        physicalName: "accounts_pk",
        columns: ["id"],
      },
    ],
  }
  const planned = createMigrationPlan(
    diffSnapshots(snapshot(dialect, []), snapshot(dialect, [accounts])),
  )

  expect(planned.ok).toBe(true)
  if (!planned.ok) {
    return
  }

  const emission = emitSqliteMigrationPlan(planned.plan)

  expect(emission.ok).toBe(false)
  expect(emission.statements).toEqual([])
  expect(emission.diagnostics.some((item) => item.code === "unsupported")).toBe(true)
})

test("rejects blocked rename plans before rendering", () => {
  const dialect = {
    name: "postgresql",
    version: 1,
  } as const
  const diff = diffSnapshots(
    snapshot(dialect, [table("accounts_old")]),
    snapshot(dialect, [table("accounts")]),
    {
      renameHints: [
        {
          kind: "table",
          namespace: "public",
          from: "accounts_old",
          to: "accounts",
        },
      ],
    },
  )
  const result = createMigrationPlan(diff)

  expect(result.ok).toBe(false)
  const emission = emitMigrationPlan(result.plan, postgresSchemaDialect)

  expect(emission.ok).toBe(false)
  expect(emission.statements).toEqual([])
  expect(emission.diagnostics.some((item) => item.code === "blocked-plan")).toBe(true)

  const reviewedPlan = createMigrationPlan(diff, {
    decisions: [
      {
        operationId: result.plan.operations[0]!.id,
        action: "allow",
        reason: "Reviewed rename",
      },
    ],
  })

  if (!reviewedPlan.ok) {
    throw new Error("Expected reviewed rename plan")
  }

  const reviewed = emitMigrationPlan(reviewedPlan.plan, postgresSchemaDialect)

  expect(reviewed.ok).toBe(true)
  expect(reviewed.statements[0]?.sql).toBe(
    'ALTER TABLE "public"."accounts_old" RENAME TO "accounts"',
  )
})

test("keeps explicit custom SQL and rejects opaque operations", () => {
  const dialect = {
    name: "postgresql",
    version: 1,
  } as const
  const diff = diffSnapshots(snapshot(dialect, []), snapshot(dialect, []))
  const result = createMigrationPlan(diff, {
    customSql: [
      {
        sql: "CREATE EXTENSION citext",
        dialect,
        safety: "safe",
        reason: "Explicit extension declaration",
        position: 4,
      },
    ],
  })

  expect(result.ok).toBe(true)
  const emission = emitPostgresMigrationPlan(result.plan)

  expect(emission.ok).toBe(true)
  expect(emission.statements[0]?.sql).toBe("CREATE EXTENSION citext")
  expect(emission.statements[0]?.parameters).toEqual([])
})

test("reports version and transaction conflicts before SQL", () => {
  const dialect = {
    name: "sqlite",
    version: 1,
  } as const
  const diff = diffSnapshots(
    snapshot(dialect, [table("accounts", [column("name")])]),
    snapshot(dialect, []),
  )
  const planned = createMigrationPlan(diff, { allowDestructive: true })

  if (!planned.ok) {
    throw new Error("Expected destructive plan to be allowed")
  }

  const result = emitSqliteMigrationPlan(planned.plan, {
    transaction: "none",
  })

  expect(result.ok).toBe(false)
  expect(result.statements).toEqual([])
  expect(result.diagnostics.some((item) => item.code === "transaction-conflict")).toBe(true)
})

test("reports malformed plans and unsupported dialect capabilities before SQL", () => {
  const malformed = emitPostgresMigrationPlan(null as unknown as MigrationPlan)

  expect(malformed.ok).toBe(false)
  expect(malformed.statements).toEqual([])
  expect(malformed.diagnostics[0]?.code).toBe("invalid-plan")

  const dialect = {
    name: "mysql",
    version: 1,
  } as const
  const before = snapshot(dialect, [table("accounts", [column("name")])])
  const after = snapshot(dialect, [
    {
      ...table("accounts", [column("name")]),
      indexes: [
        {
          id: "accounts_name",
          kind: "index" as const,
          physicalName: "accounts_name",
          terms: [
            {
              kind: "column" as const,
              column: "name",
            },
          ],
          unique: false,
          candidateKey: false,
          predicate: {
            kind: "expression" as const,
            expressionKind: "check",
            sql: "name IS NOT NULL",
          },
        },
      ],
    },
  ])
  const planned = createMigrationPlan(diffSnapshots(before, after))

  expect(planned.ok).toBe(true)
  if (!planned.ok) {
    return
  }

  const emission = emitMysqlMigrationPlan(planned.plan)

  expect(emission.ok).toBe(false)
  expect(emission.statements).toEqual([])
  expect(emission.diagnostics.some((item) => item.code === "unsupported")).toBe(true)
})
