import { diffSnapshots } from "qubu/diff"
import type { SchemaSnapshot } from "qubu/snapshot"
import { mysqlSchemaDialect } from "qubu/snapshot/mysql"
import { postgresSchemaDialect } from "qubu/snapshot/postgres"
import { sqliteSchemaDialect } from "qubu/snapshot/sqlite"
import { expect, test } from "vitest"

import { compileMigrationProgram } from "../src/artifact/program.ts"
import { physicalSnapshot } from "../src/ddl/column-order.ts"
import { emitMigrationPlan } from "../src/ddl/index.ts"
import * as mysqlDdl from "../src/ddl/mysql.ts"
import * as postgresDdl from "../src/ddl/postgres.ts"
import * as sqliteDdl from "../src/ddl/sqlite.ts"
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
    namespace:
      dialect.name === "sqlite"
        ? { kind: "sqlite-database", name: "main" }
        : dialect.name === "mysql"
          ? { kind: "mysql-database", name: "public" }
          : { kind: "postgres-schema", name: "public" },
    capabilities: {
      generatedColumns: true,
      identityMetadata: true,
      checkConstraints: true,
      checkConstraintEnforcement: "enforced",
      expressionDecompilation: true,
      indexExpressions: true,
      indexPredicates: true,
      indexIncludedColumns: true,
      namespaces: true,
      visibility: "complete",
    },
    tables,
    views: [],
    sequences: [],
    enums: [],
    domains: [],
    collations: [],
    triggers: [],
    routines: [],
    partitions: [],
    policies: [],
    extensions: [],
    deferredObjects: [],
    opaqueObjects: [],
    comments: [],
    ownership: [],
  }
}

function table(
  id: string,
  columns: SchemaSnapshot["tables"][number]["columns"] = [],
): SchemaSnapshot["tables"][number] {
  return {
    kind: "table",
    id,
    physicalName: id,
    columns: columns.map((column, index) => ({ ...column, ordinalPosition: index + 1 })),
    constraints: [],
    indexes: [],
  }
}

function column(id: string): SchemaSnapshot["tables"][number]["columns"][number] {
  return {
    kind: "column" as const,
    id,
    physicalName: id,
    ordinalPosition: 1,
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
  const postgres = postgresDdl.emitMigrationPlan(
    planFor({
      name: "postgresql",
      version: 1,
    }),
  )
  const sqlite = sqliteDdl.emitMigrationPlan(
    planFor({
      name: "sqlite",
      version: 1,
    }),
  )
  const mysql = mysqlDdl.emitMigrationPlan(
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
            position: 0,
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

  const emission = postgresDdl.emitMigrationPlan(planned.plan)

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

test("renders SQLite constraints inline during table creation", () => {
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

  const emission = sqliteDdl.emitMigrationPlan(planned.plan)

  expect(emission.ok).toBe(true)
  expect(emission.statements).toHaveLength(1)
  expect(emission.statements[0]?.sql).toContain('CONSTRAINT "accounts_pk" PRIMARY KEY ("id")')
})

test("renders v1 foreign-key object references inline during SQLite table creation", () => {
  const dialect = {
    name: "sqlite",
    version: 1,
  } as const
  const parent = table("parent", [column("id")])
  const child = {
    ...table("child", [column("parentId")]),
    constraints: [
      {
        id: "child_parent_fk",
        kind: "foreign-key" as const,
        physicalName: "child_parent_fk",
        columns: ["parentId"],
        target: {
          table: {
            kind: "table" as const,
            id: "parent",
          },
          columns: ["id"],
        },
      },
    ],
  }
  const planned = createMigrationPlan(
    diffSnapshots(snapshot(dialect, []), snapshot(dialect, [parent, child])),
  )

  expect(planned.ok).toBe(true)
  if (!planned.ok) {
    return
  }

  const emission = sqliteDdl.emitMigrationPlan(planned.plan)

  expect(emission.ok).toBe(true)
  expect(emission.sql).toContain(
    'CONSTRAINT "child_parent_fk" FOREIGN KEY ("parentId") REFERENCES "parent" ("id")',
  )
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

test("renders a reviewed column rename with its nullable narrowing", () => {
  const dialect = {
    name: "postgresql",
    version: 1,
  } as const
  const before = snapshot(dialect, [
    table("accounts", [
      {
        ...column("name"),
        physicalName: "legacy_name",
        nullable: true,
      },
    ]),
  ])
  const after = snapshot(dialect, [
    table("accounts", [
      {
        ...column("name"),
        physicalName: "name",
        nullable: false,
      },
    ]),
  ])
  const planned = createMigrationPlan(diffSnapshots(before, after), {
    allowDestructive: true,
  })

  expect(planned.ok).toBe(true)
  if (!planned.ok) {
    return
  }

  const emission = postgresDdl.emitMigrationPlan(planned.plan, {
    allowDestructive: true,
  })

  expect(emission.ok).toBe(true)
  expect(emission.statements).toHaveLength(1)
  expect(emission.statements[0]?.sql).toBe(
    'ALTER TABLE "public"."accounts" RENAME COLUMN "legacy_name" TO "name";\nALTER TABLE "public"."accounts" ALTER COLUMN "name" SET NOT NULL',
  )
  expect(emission.sql).toBe(`${emission.statements[0]?.sql};`)
})

test("blocks SQLite column renames with concurrent property changes", () => {
  const dialect = {
    name: "sqlite",
    version: 1,
  } as const
  const before = snapshot(dialect, [
    table("accounts", [
      {
        ...column("name"),
        physicalName: "legacy_name",
        nullable: true,
      },
    ]),
  ])
  const after = snapshot(dialect, [
    table("accounts", [
      {
        ...column("name"),
        physicalName: "name",
        nullable: false,
      },
    ]),
  ])
  const planned = createMigrationPlan(diffSnapshots(before, after), {
    allowDestructive: true,
  })

  expect(planned.ok).toBe(true)
  if (!planned.ok) {
    return
  }

  const emission = sqliteDdl.emitMigrationPlan(planned.plan, {
    allowDestructive: true,
  })

  expect(emission.ok).toBe(false)
  expect(emission.statements).toEqual([])
  expect(
    emission.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "unsupported" &&
        diagnostic.message.includes("concurrent property changes"),
    ),
  ).toBe(true)
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
  const emission = postgresDdl.emitMigrationPlan(result.plan)

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

  const result = sqliteDdl.emitMigrationPlan(planned.plan, {
    transaction: "none",
  })

  expect(result.ok).toBe(false)
  expect(result.statements).toEqual([])
  expect(result.diagnostics.some((item) => item.code === "transaction-conflict")).toBe(true)
})

test("reports malformed plans and unsupported dialect capabilities before SQL", () => {
  const malformed = postgresDdl.emitMigrationPlan(null as unknown as MigrationPlan)

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
              position: 0,
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

  const emission = mysqlDdl.emitMigrationPlan(planned.plan)

  expect(emission.ok).toBe(false)
  expect(emission.statements).toEqual([])
  expect(emission.diagnostics.some((item) => item.code === "unsupported")).toBe(true)
})

test("creates columns in ordinal order across dialects without mutating snapshots", () => {
  for (const name of ["postgresql", "mysql", "sqlite"] as const) {
    const dialect = { name, version: 1 }
    const target = snapshot(dialect, [
      {
        ...table("ordered"),
        columns: [
          { ...column("alpha"), ordinalPosition: 2 },
          { ...column("zulu"), ordinalPosition: 1 },
        ],
      },
    ])
    const planned = createMigrationPlan(diffSnapshots(snapshot(dialect, []), target))
    expect(planned.ok).toBe(true)
    if (!planned.ok) throw new Error("Expected plan")
    const emitter = name === "postgresql" ? postgresDdl : name === "mysql" ? mysqlDdl : sqliteDdl
    const result = emitter.emitMigrationPlan(planned.plan)
    expect(result.ok).toBe(true)
    expect(result.sql.indexOf("zulu")).toBeLessThan(result.sql.indexOf("alpha"))
    expect(target.tables[0]!.columns.map((column) => column.id)).toEqual(["alpha", "zulu"])
  }
})

test("packs known PostgreSQL fields stably and keeps variable or unknown types conservative", () => {
  const dialect = {
    name: "postgresql",
    version: 1,
  }
  const columns = [
    {
      ...column("flag"),
      storage: {
        kind: "portable" as const,
        type: "boolean",
      },
    },
    {
      ...column("label"),
      storage: {
        kind: "portable" as const,
        type: "text",
      },
    },
    {
      ...column("count"),
      storage: {
        kind: "portable" as const,
        type: "integer",
      },
    },
    {
      ...column("created"),
      storage: {
        kind: "portable" as const,
        type: "timestamp",
      },
    },
    {
      ...column("updated"),
      storage: {
        kind: "portable" as const,
        type: "timestamp",
      },
    },
    {
      ...column("custom"),
      storage: {
        kind: "native" as const,
        dialect: "postgresql",
        type: "custom_type",
      },
    },
  ]
  const target = snapshot(dialect, [table("packed", columns)])
  const planned = createMigrationPlan(diffSnapshots(snapshot(dialect, []), target))

  if (!planned.ok) {
    throw new Error("Expected plan")
  }
  const packed = postgresDdl.emitMigrationPlan(planned.plan, { columnOrder: "alignment" })

  expect(packed.ok).toBe(true)
  const expected = ["created", "updated", "count", "flag", "label", "custom"]

  expect(packed.sql.match(/"(?:created|updated|count|flag|label|custom)"/g)).toEqual(
    expected.map((name) => `"${name}"`),
  )
  const compiled = compileMigrationProgram(planned.plan, postgresSchemaDialect, {
    columnOrder: "alignment",
  })

  if (!compiled.ok) {
    throw new Error(JSON.stringify(compiled.diagnostics))
  }
  expect(
    compiled.program.phases
      .flatMap((phase) => phase.statements)
      .map((statement) => statement.sql)
      .join("\n"),
  ).toBe(packed.sql.replace(/;$/, ""))
  expect(compiled.program.columnOrder).toBe("alignment")
  const observed = physicalSnapshot(undefined, target, "alignment")

  expect(
    [...observed.tables[0]!.columns]
      .sort((a, b) => a.ordinalPosition - b.ordinalPosition)
      .map((column) => column.id),
  ).toEqual(expected)
  expect(diffSnapshots(observed, target).operations).toEqual([])
  expect(physicalSnapshot(observed, target, "declaration")).toEqual(observed)
  expect(postgresDdl.emitMigrationPlan(planned.plan).sql).not.toBe(packed.sql)
  const expanded = snapshot(dialect, [
    {
      ...target.tables[0]!,
      columns: [
        {
          ...column("added"),
          ordinalPosition: 1,
          nullable: true,
        },
        ...target.tables[0]!.columns.map((column) => ({
          ...column,
          ordinalPosition: column.ordinalPosition + 1,
        })),
      ],
    },
  ])
  const alteration = createMigrationPlan(diffSnapshots(observed, expanded))

  if (!alteration.ok) {
    throw new Error(JSON.stringify(alteration.diagnostics))
  }
  const altered = physicalSnapshot(observed, expanded, "alignment", alteration.plan)

  expect(altered.tables[0]!.columns.find((column) => column.id === "added")!.ordinalPosition).toBe(
    7,
  )
  expect(
    altered.tables[0]!.columns.find((column) => column.id === "created")!.ordinalPosition,
  ).toBe(1)
  expect(postgresDdl.emitMigrationPlan(alteration.plan, { columnOrder: "alignment" }).sql).toBe(
    'ALTER TABLE "public"."packed" ADD COLUMN "added" TEXT;',
  )
})

test("rejects alignment for MySQL and SQLite even with unsafe rendering allowed", () => {
  for (const name of ["mysql", "sqlite"] as const) {
    const plan = planFor({
      name,
      version: 1,
    })
    const emitter = name === "mysql" ? mysqlDdl : sqliteDdl
    const result = emitter.emitMigrationPlan(plan, {
      columnOrder: "alignment",
      allowUnsafe: true,
    })

    expect(result.ok).toBe(false)
    expect(result.statements).toEqual([])
    expect(result.diagnostics[0]?.path).toEqual(["columnOrder"])
    expect(
      compileMigrationProgram(plan, name === "mysql" ? mysqlSchemaDialect : sqliteSchemaDialect, {
        columnOrder: "alignment",
      }).ok,
    ).toBe(false)
  }
})

test("retains physical order and dialect-specific ordinal gaps after dropping a column", () => {
  for (const name of ["postgresql", "mysql", "sqlite"] as const) {
    const dialect = { name, version: 1 }
    const before = snapshot(dialect, [
      table("ordered", [column("first"), column("removed"), column("last")]),
    ])
    const after = snapshot(dialect, [table("ordered", [column("last"), column("first")])])
    const actual = physicalSnapshot(before, after)
    expect(actual.tables[0]!.columns.map((column) => [column.id, column.ordinalPosition])).toEqual([
      ["last", name === "postgresql" ? 3 : 2],
      ["first", 1],
    ])
  }
})
