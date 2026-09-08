import { diffSnapshots } from "qubu/diff"
import { canonicalizeSchemaSnapshot, type SchemaSnapshot } from "qubu/snapshot"
import { postgresSchemaDialect } from "qubu/snapshot/postgres"
import { expect, test } from "vitest"

import {
  sealExecutableArtifact,
  decodeExecutableArtifact,
  encodeExecutableArtifact,
  type CustomProgramSubstitution,
  type OperationApproval,
  validateMigrationProgram,
} from "../src/artifact/index.ts"
import { compileMigrationProgram as compileGenericMigrationProgram } from "../src/artifact/program.ts"
import { compileMigrationProgram } from "../src/artifact/sqlite.ts"
import { createMigrationPlan, type MigrationPlan } from "../src/plan/index.ts"

const dialect = { name: "sqlite", version: 1 } as const

function snapshot(tables: SchemaSnapshot["tables"] = []): SchemaSnapshot {
  return {
    format: "qubu-schema",
    version: 1,
    dialect,
    namingPolicy: { name: "test", version: 1 },
    namespace: { kind: "sqlite-database", name: "main" },
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

test("rejects a structured guard whose payload reverses its declared condition", () => {
  const program = {
    format: "qubu-migration-program",
    version: 1,
    phases: [
      {
        id: "guard",
        position: 0,
        transaction: "optional",
        lock: "none",
        dependsOn: [],
        statements: [],
        preconditions: [
          {
            id: "present",
            type: "object-present",
            value: {
              type: "object-absent",
              path: ["tables"],
              kind: "table",
              physicalName: "accounts",
            },
          },
        ],
        postconditions: [],
      },
    ],
  }
  expect(validateMigrationProgram(program)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: "invalid-value",
        path: ["program", "phases", 0, "preconditions", 0, "value"],
      }),
    ]),
  )
})

test("rejects forward dependencies in standalone programs", () => {
  const program = {
    format: "qubu-migration-program",
    version: 1,
    phases: [
      {
        id: "first",
        position: 0,
        transaction: "optional",
        lock: "none",
        dependsOn: ["later"],
        statements: [],
        preconditions: [],
        postconditions: [],
      },
      {
        id: "later",
        position: 1,
        transaction: "optional",
        lock: "none",
        dependsOn: [],
        statements: [],
        preconditions: [],
        postconditions: [],
      },
    ],
  }
  expect(validateMigrationProgram(program)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: "invalid-value",
        path: ["program", "phases", 0, "dependsOn"],
      }),
    ]),
  )
})

function table(id: string, columns: SchemaSnapshot["tables"][number]["columns"] = []) {
  return { kind: "table" as const, id, physicalName: id, columns, constraints: [], indexes: [] }
}

function column(id: string): SchemaSnapshot["tables"][number]["columns"][number] {
  return {
    kind: "column",
    id,
    physicalName: id,
    ordinalPosition: 1,
    nullable: false,
    hasDefault: false,
    generated: false,
    storage: { kind: "portable" as const, type: "text" },
  }
}

function creationPlan(): MigrationPlan {
  const result = createMigrationPlan(
    diffSnapshots(snapshot(), snapshot([table("accounts", [column("name")])])),
  )
  if (!result.ok) throw new Error("Expected safe creation plan")
  return result.plan
}

function propertyChangePlan(): MigrationPlan {
  const before = {
    ...snapshot([table("accounts", [column("name")])]),
    dialect: { name: "postgresql", version: 1 } as const,
    namespace: { kind: "postgres-schema", name: "public" } as const,
  }
  const after = {
    ...before,
    tables: [table("accounts", [{ ...column("name"), nullable: true }])],
  }
  const result = createMigrationPlan(diffSnapshots(before, after), { allowReviewRequired: true })
  if (!result.ok) throw new Error("Expected safe property-change plan")
  return result.plan
}
test("preserves property and snapshot fingerprint condition types through compilation", () => {
  const original = creationPlan()
  const plan: MigrationPlan = {
    ...original,
    operations: original.operations.map((operation) => ({
      ...operation,
      preconditions: [
        {
          type: "property-equals",
          kind: "table",
          path: ["tables", 0],
          physicalName: "accounts",
          property: ["physicalName"],
          value: "accounts",
        },
        {
          type: "snapshot-fingerprint",
          kind: "table",
          path: [],
          fingerprint: original.beforeFingerprint,
        },
      ],
    })),
  }
  const result = compileMigrationProgram(plan)
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.program.phases[0]!.preconditions.map((condition) => condition.type)).toEqual([
    "property-equals",
    "snapshot-fingerprint",
  ])
  expect(validateMigrationProgram(result.program, plan)).toEqual([])
})

test("carries a physical parent reference for column preconditions", () => {
  const before = snapshot([
    { ...table("logicalAccounts", [column("name")]), physicalName: "accounts" },
  ])
  const after = snapshot([
    {
      ...before.tables[0]!,
      columns: [column("name"), { ...column("nickname"), ordinalPosition: 2, nullable: true }],
    },
  ])
  const result = createMigrationPlan(diffSnapshots(before, after))
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(
    result.plan.operations.find((operation) => operation.kind === "column")?.preconditions[0],
  ).toMatchObject({
    parent: { kind: "table", id: "logicalAccounts", physicalName: "accounts" },
    path: ["tables", 0, "columns", 1],
  })
  const compiled = compileMigrationProgram(result.plan)
  expect(compiled.ok).toBe(true)
  if (!compiled.ok) return
  expect(compiled.program.phases[0]!.preconditions[0]!.value).toMatchObject({
    parent: { physicalName: "accounts" },
  })
})

function customPlan(): MigrationPlan {
  const result = createMigrationPlan(diffSnapshots(snapshot(), snapshot()), {
    customSql: [
      {
        sql: "SELECT ?",
        dialect,
        safety: "safe",
        reason: "Application-owned data verification",
      },
    ],
  })
  if (!result.ok) throw new Error("Expected explicit custom SQL plan")
  return result.plan
}

function approvalFor(
  plan: MigrationPlan,
  decision: OperationApproval["decision"],
): OperationApproval {
  const operation = plan.operations[0]!
  return {
    operationId: operation.id,
    decision,
    safety: operation.safety,
    findings: plan.diagnostics
      .filter((finding) => finding.operationId === operation.id)
      .map((finding) => finding.code)
      .sort(),
    reason: "Reviewed exact program",
  }
}

test("compiles a plan into contiguous authoritative phases and statements", () => {
  const plan = creationPlan()
  const result = compileMigrationProgram(plan)

  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.program).toMatchObject({
    format: "qubu-migration-program",
    version: 1,
  })
  expect(result.program.phases.map((phase) => phase.position)).toEqual([0])
  expect(
    result.program.phases.map((phase) => phase.statements.map((statement) => statement.position)),
  ).toEqual([[0]])
  expect(result.program.phases[0]?.statements[0]).toMatchObject({
    operationId: plan.operations.find((operation) => operation.kind === "table")?.id,
    sql: 'CREATE TABLE "main"."accounts" ("name" TEXT NOT NULL)',
    parameters: [],
  })
  expect(result.program.phases[0]?.transaction).toBe("optional")
  expect(result.program.phases[0]?.lock).toBe("exclusive")
  expect("sql" in result.program).toBe(false)
})

test("keeps property preconditions structured in the executable program", () => {
  const plan = propertyChangePlan()
  const result = compileGenericMigrationProgram(plan, postgresSchemaDialect, {
    approvals: [approvalFor(plan, "approve")],
  })

  expect(result.ok).toBe(true)
  if (!result.ok) return

  expect(result.program.phases[0]?.preconditions).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "property-equals",
        value: expect.objectContaining({
          type: "property-equals",
          property: ["nullable"],
          value: false,
          parent: { kind: "table", id: "accounts", namespace: "public", physicalName: "accounts" },
        }),
      }),
    ]),
  )
  expect(validateMigrationProgram(result.program, plan)).toEqual([])
})

test("requires exact custom-program approval and preserves tagged parameters and provenance", async () => {
  const plan = customPlan()
  const operationId = plan.operations[0]!.id
  const customProgram: CustomProgramSubstitution = {
    operationId,
    source: "application-migration",
    reason: "Qubu does not own this statement",
    revision: "abc123",
    transaction: "required",
    lock: "exclusive",
    statements: [
      {
        sql: "SELECT ?",
        parameters: [{ type: "bigint", value: "42" }],
      },
    ],
  }

  expect(
    compileMigrationProgram(plan, {
      approvals: [approvalFor(plan, "approve")],
      customPrograms: [customProgram],
    }),
  ).toMatchObject({ ok: false })

  const result = compileMigrationProgram(plan, {
    approvals: [approvalFor(plan, "custom-program")],
    customPrograms: [customProgram],
  })
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.program.phases[0]).toMatchObject({
    transaction: "required",
    lock: "exclusive",
    statements: [{ operationId, parameters: [{ type: "bigint", value: "42" }] }],
  })
  expect(result.customPrograms).toEqual([
    {
      operationId,
      source: "application-migration",
      reason: "Qubu does not own this statement",
      revision: "abc123",
    },
  ])

  await expect(
    sealExecutableArtifact({
      format: "qubu-executable-migration",
      version: 1,
      id: "custom-program",
      sequence: 0,
      parentArtifactDigest: null,
      dialect,
      plan,
      renderer: { id: "qubu-sqlite", version: 1, dialect },
      program: result.program,
      beforeSnapshot: { value: snapshot() },
      afterSnapshot: { value: snapshot() },
      approvals: [approvalFor(plan, "custom-program")],
      customPrograms: result.customPrograms,
      provenance: { source: "unit-test" },
    }),
  ).resolves.toMatchObject({ id: "custom-program" })
})

test("compiles SQLite table rebuilds into explicit copy and swap statements", () => {
  const before = snapshot([table("accounts", [column("name")])])
  const after = snapshot([
    {
      ...table("accounts", [{ ...column("name"), nullable: true }]),
      constraints: [
        {
          id: "name_unique",
          kind: "unique" as const,
          physicalName: "accounts_name_unique",
          columns: ["name"],
        },
      ],
    },
  ])
  const planned = createMigrationPlan(diffSnapshots(before, after), {
    allowReviewRequired: true,
    allowDestructive: true,
    allowUnsupported: true,
    allowUnknown: true,
    allowLossy: true,
  })
  expect(planned.ok).toBe(true)
  if (!planned.ok) return
  const approvals = planned.plan.operations
    .filter((operation) => operation.safety !== "safe")
    .map((operation) => ({
      operationId: operation.id,
      decision: "approve" as const,
      safety: operation.safety,
      findings: planned.plan.diagnostics
        .filter((finding) => finding.operationId === operation.id)
        .map((finding) => finding.code)
        .sort(),
      reason: "Reviewed rebuild",
    }))

  const result = compileMigrationProgram(planned.plan, {
    beforeSnapshot: before,
    afterSnapshot: after,
    approvals,
  })

  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.program.phases).toHaveLength(1)
  expect(result.program.phases[0]).toMatchObject({ transaction: "required", lock: "exclusive" })
  expect(result.program.phases[0]?.statements.map((statement) => statement.sql)).toEqual([
    expect.stringContaining('CREATE TABLE "main"."__qubu_rebuild_accounts"'),
    'INSERT INTO "main"."__qubu_rebuild_accounts" ("name") SELECT "name" FROM "main"."accounts"',
    'DROP TABLE "main"."accounts"',
    'ALTER TABLE "main"."__qubu_rebuild_accounts" RENAME TO "accounts"',
  ])
  expect(result.program.phases[0]?.postconditions).toEqual([
    expect.objectContaining({ type: "object-present" }),
  ])
})

test("rejects custom transaction conflicts instead of weakening requirements", () => {
  const plan = customPlan()
  const operationId = plan.operations[0]!.id
  const requiredPlan = {
    ...plan,
    operations: plan.operations.map((operation) => ({
      ...operation,
      transaction: "required" as const,
    })),
  }
  const result = compileMigrationProgram(requiredPlan, {
    approvals: [approvalFor(requiredPlan, "custom-program")],
    customPrograms: [
      {
        operationId,
        source: "unit-test",
        reason: "Exercise conservative resolution",
        transaction: "forbidden",
        lock: "none",
        statements: [{ sql: "SELECT 1" }],
      },
    ],
  })

  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("transaction-conflict")
})

test("rejects malformed tagged custom parameters before producing a program", () => {
  const plan = customPlan()
  const operationId = plan.operations[0]!.id
  const result = compileMigrationProgram(plan, {
    approvals: [approvalFor(plan, "custom-program")],
    customPrograms: [
      {
        operationId,
        source: "unit-test",
        reason: "Exercise parameter validation",
        transaction: "optional",
        lock: "shared",
        statements: [
          {
            sql: "SELECT ?",
            parameters: [{ type: "number", value: "NaN" }],
          },
        ],
      },
    ],
  })

  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.diagnostics[0]?.path).toEqual([
    "program",
    "phases",
    0,
    "statements",
    0,
    "parameters",
    0,
    "value",
  ])
})

function rebuildFixture(id = "accounts") {
  const before = snapshot([table(id, [column("name")]), table("existing", [column("value")])])
  const after = snapshot([
    table(id, [
      { ...column("name"), nullable: true },
      { ...column("extra"), ordinalPosition: 2, nullable: true },
    ]),
    table("new_table", [column("value")]),
    table("existing", [
      { ...column("added"), nullable: true, ordinalPosition: 2 },
      column("value"),
    ]),
  ])
  return { before, after }
}

function reviewed(before: SchemaSnapshot, after: SchemaSnapshot) {
  const canonical = (value: SchemaSnapshot) =>
    canonicalizeSchemaSnapshot({
      ...value,
      tables: [...value.tables]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((table) => ({
          ...table,
          columns: [...table.columns].sort((a, b) => a.id.localeCompare(b.id)),
        })),
    })
  before = canonical(before)
  after = canonical(after)
  const result = createMigrationPlan(diffSnapshots(before, after), {
    allowReviewRequired: true,
    allowDestructive: true,
    allowUnsupported: true,
    allowUnknown: true,
    allowLossy: true,
  })
  if (!result.ok) throw new Error("Expected reviewed plan")
  const approvals: OperationApproval[] = result.plan.operations
    .filter((operation) => operation.safety !== "safe")
    .map((operation) => ({
      operationId: operation.id,
      decision: "approve",
      safety: operation.safety,
      findings: result.plan.diagnostics
        .filter((finding) => finding.operationId === operation.id)
        .map((finding) => finding.code)
        .sort(),
      reason: "Reviewed exact change",
    }))
  return {
    plan: result.plan,
    approvals,
    beforeSnapshot: canonicalizeSchemaSnapshot(before),
    afterSnapshot: canonicalizeSchemaSnapshot(after),
  }
}

test("emits mixed rebuild and new-table operations exactly once and seals their coverage", async () => {
  const { before, after } = rebuildFixture("logical/table:with spaces".repeat(20))
  const input = reviewed(before, after)
  const compiled = compileMigrationProgram(input.plan, input)
  expect(compiled).toMatchObject({ ok: true })
  if (!compiled.ok) return
  const sql = compiled.program.phases.flatMap((phase) =>
    phase.statements.map((statement) => statement.sql),
  )
  expect(sql.filter((statement) => statement.startsWith("CREATE TABLE"))).toHaveLength(2)
  expect(sql.filter((statement) => statement.includes('ADD COLUMN "extra"'))).toHaveLength(0)
  expect(
    sql.filter((statement) =>
      statement.startsWith('ALTER TABLE "main"."existing" ADD COLUMN "added"'),
    ),
  ).toHaveLength(1)
  expect(sql.join("\n")).toContain('"extra" TEXT')
  const represented = compiled.program.phases.flatMap((phase) => [
    ...new Set(phase.statements.map((statement) => statement.operationId)),
    ...(phase.absorbedOperationIds ?? []),
  ])
  expect(represented.sort()).toEqual(input.plan.operations.map((operation) => operation.id).sort())
  expect(validateMigrationProgram(compiled.program, input.plan)).toEqual([])
  const sealed = await sealExecutableArtifact({
    format: "qubu-executable-migration",
    version: 1,
    id: "mixed-rebuild",
    sequence: 1,
    parentArtifactDigest: null,
    dialect,
    plan: input.plan,
    renderer: { id: "sqlite", version: 1, dialect },
    program: compiled.program,
    beforeSnapshot: { value: input.beforeSnapshot },
    afterSnapshot: { value: input.afterSnapshot },
    approvals: input.approvals,
    customPrograms: compiled.customPrograms,
    provenance: { source: "test" },
  })
  expect(sealed.program).toEqual(compiled.program)
  expect(await decodeExecutableArtifact(encodeExecutableArtifact(sealed))).toMatchObject({
    ok: true,
    value: sealed,
  })
  const omitted = {
    ...compiled.program,
    phases: compiled.program.phases.filter(
      (phase) =>
        !phase.statements.some((statement) =>
          statement.sql.includes('CREATE TABLE "main"."new_table"'),
        ),
    ),
  }
  expect(validateMigrationProgram(omitted, input.plan)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: "invalid-value",
        message: expect.stringContaining("must be emitted"),
      }),
    ]),
  )
})

test("preserves unrelated custom SQL, provenance, tagged values, conditions, and transaction boundaries", () => {
  const { before, after } = rebuildFixture()
  const initial = reviewed(before, after)
  const rebuild = initial.plan.operations.find((operation) => operation.type === "property-change")!
  const planned = createMigrationPlan(diffSnapshots(before, after), {
    allowReviewRequired: true,
    customSql: [
      {
        sql: "SELECT ?",
        dialect,
        safety: "safe",
        reason: "Verify copied rows",
        dependsOn: [rebuild.id],
      },
    ],
  })
  expect(planned.ok).toBe(true)
  if (!planned.ok) return
  const operation = planned.plan.operations.find((operation) => operation.type === "custom-sql")!
  const custom: CustomProgramSubstitution = {
    operationId: operation.id,
    source: "review.sql",
    revision: "abc",
    reason: "Verify copied rows",
    transaction: "forbidden",
    lock: "shared",
    statements: [{ sql: "SELECT ?", parameters: [{ type: "string", value: "payload" }] }],
    preconditions: [{ id: "custom-before", type: "statement", value: "SELECT 1" }],
    postconditions: [{ id: "custom-after", type: "statement", value: "SELECT 1" }],
  }
  const result = compileMigrationProgram(planned.plan, {
    ...initial,
    approvals: [
      ...initial.approvals,
      {
        operationId: operation.id,
        decision: "custom-program",
        safety: operation.safety,
        findings: planned.plan.diagnostics
          .filter((finding) => finding.operationId === operation.id)
          .map((finding) => finding.code)
          .sort(),
        reason: "Reviewed SQL",
      },
    ],
    customPrograms: [custom],
  })
  expect(result).toMatchObject({ ok: true })
  if (!result.ok) return
  const customPhase = result.program.phases.find((phase) =>
    phase.statements.some((statement) => statement.operationId === operation.id),
  )!
  const rebuildPhase = result.program.phases.find((phase) =>
    phase.statements.some((statement) => statement.sql.startsWith("INSERT INTO")),
  )!
  expect(customPhase.position).toBeGreaterThan(rebuildPhase.position)
  expect(customPhase).toMatchObject({
    transaction: "forbidden",
    lock: "shared",
    preconditions: [expect.objectContaining({ type: "statement", value: "SELECT 1" })],
    postconditions: [expect.objectContaining({ type: "statement", value: "SELECT 1" })],
    statements: [
      expect.objectContaining({
        sql: "SELECT ?",
        parameters: [{ type: "string", value: "payload" }],
      }),
    ],
  })
  expect(result.customPrograms).toEqual([
    {
      operationId: operation.id,
      source: "review.sql",
      revision: "abc",
      reason: "Verify copied rows",
    },
  ])
})

test("rejects stale rebuild snapshots and row copies without shared column identities", () => {
  const { before, after } = rebuildFixture()
  const input = reviewed(before, after)
  const stale = compileMigrationProgram(input.plan, {
    ...input,
    afterSnapshot: { ...after, tables: [table("accounts", [column("unreviewed")])] },
  })
  expect(stale).toMatchObject({
    ok: false,
    diagnostics: [expect.objectContaining({ code: "unsupported", path: ["afterSnapshot"] })],
  })
  const replacement = snapshot([table("accounts", [column("replacement")])])
  const emptyCopy = reviewed(before, replacement)
  expect(compileMigrationProgram(emptyCopy.plan, emptyCopy)).toMatchObject({
    ok: false,
    diagnostics: [
      expect.objectContaining({
        code: "unsupported",
        message: expect.stringContaining("shared source and target"),
      }),
    ],
  })
})

test("keeps skipped rebuild-only plans empty and rejects stale targets that mix skipped and active members", () => {
  const before = snapshot([table("accounts", [column("name")])])
  const after = snapshot([table("accounts", [{ ...column("name"), nullable: true }])])
  const first = reviewed(before, after)
  const skipped = createMigrationPlan(diffSnapshots(before, after), {
    decisions: [
      { operationId: first.plan.operations[0]!.id, action: "skip", reason: "Keep original" },
    ],
  })
  expect(skipped.ok).toBe(true)
  const result = compileMigrationProgram(skipped.plan)
  expect(result).toMatchObject({ ok: true, program: { phases: [] } })
  const mixedAfter = snapshot([
    table("accounts", [
      { ...column("name"), nullable: true },
      { ...column("extra"), ordinalPosition: 2, nullable: true },
    ]),
  ])
  const mixedInput = reviewed(before, mixedAfter)
  const skippedId = mixedInput.plan.operations.find(
    (operation) => operation.logicalId === "extra",
  )!.id
  const mixed = createMigrationPlan(
    diffSnapshots(mixedInput.beforeSnapshot, mixedInput.afterSnapshot),
    {
      allowReviewRequired: true,
      decisions: [{ operationId: skippedId, action: "skip", reason: "Keep extra absent" }],
    },
  )
  expect(mixed.ok).toBe(true)
  expect(compileMigrationProgram(mixed.plan, mixedInput)).toMatchObject({
    ok: false,
    diagnostics: [
      expect.objectContaining({
        code: "unsupported",
        message: expect.stringContaining("skipped table changes"),
      }),
    ],
  })
})

test("retains strict plan, dialect, column-order, and exact approval validation on rebuild paths", () => {
  const { before, after } = rebuildFixture()
  const input = reviewed(before, after)
  for (const plan of [
    { ...input.plan, ready: false },
    { ...input.plan, operations: null },
  ]) {
    expect(compileMigrationProgram(plan as MigrationPlan, input)).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: "invalid-plan" })],
    })
  }
  expect(compileMigrationProgram(propertyChangePlan(), input)).toMatchObject({
    ok: false,
    diagnostics: [expect.objectContaining({ code: "dialect-mismatch" })],
  })
  expect(compileMigrationProgram(input.plan, { ...input, columnOrder: "alignment" })).toMatchObject(
    {
      ok: false,
      diagnostics: [expect.objectContaining({ code: "unsupported", path: ["columnOrder"] })],
    },
  )
  expect(compileMigrationProgram(input.plan, { ...input, approvals: [] })).toMatchObject({
    ok: false,
    diagnostics: expect.arrayContaining([expect.objectContaining({ code: "approval-required" })]),
  })
  expect(
    compileMigrationProgram(input.plan, {
      ...input,
      approvals: [...input.approvals, ...input.approvals],
    }),
  ).toMatchObject({
    ok: false,
    diagnostics: expect.arrayContaining([expect.objectContaining({ code: "invalid-approval" })]),
  })
  expect(
    compileMigrationProgram(input.plan, {
      ...input,
      approvals: [...input.approvals, { ...input.approvals[0]!, operationId: "unknown" }],
    }),
  ).toMatchObject({
    ok: false,
    diagnostics: expect.arrayContaining([expect.objectContaining({ code: "invalid-approval" })]),
  })
  expect(
    compileMigrationProgram(input.plan, {
      ...input,
      approvals: input.approvals.map((approval) => ({ ...approval, findings: ["wrong"] })),
    }),
  ).toMatchObject({
    ok: false,
    diagnostics: expect.arrayContaining([expect.objectContaining({ code: "invalid-approval" })]),
  })
})

test("rejects rebuild transaction conflicts and bounded-group dependency cycles", () => {
  const { before, after } = rebuildFixture()
  const input = reviewed(before, after)
  const forbidden = {
    ...input.plan,
    operations: input.plan.operations.map((operation) =>
      operation.type === "property-change"
        ? { ...operation, transaction: "forbidden" as const }
        : operation,
    ),
  }
  expect(compileMigrationProgram(forbidden, input)).toMatchObject({
    ok: false,
    diagnostics: expect.arrayContaining([
      expect.objectContaining({ code: "transaction-conflict" }),
    ]),
  })
  const change = input.plan.operations.find((operation) => operation.type === "property-change")!
  const addition = input.plan.operations.find(
    (operation) => operation.kind === "column" && operation.logicalId === "extra",
  )!
  const custom = createMigrationPlan(diffSnapshots(before, after), {
    allowReviewRequired: true,
    customSql: [
      {
        sql: "SELECT 1",
        dialect,
        safety: "safe",
        reason: "Between grouped changes",
        dependsOn: [change.id],
      },
    ],
  }).plan
  const sqlOperation = custom.operations.find((operation) => operation.type === "custom-sql")!
  const cycle: MigrationPlan = {
    ...custom,
    operations: [
      ...custom.operations.filter((operation) => operation.id !== addition.id),
      { ...addition, dependsOn: [sqlOperation.id] },
    ].map((operation, position) => ({ ...operation, position })),
    dependencies: [
      ...custom.dependencies,
      { from: sqlOperation.id, to: addition.id, reason: "explicit-custom-sql" as const },
    ].sort(
      (a, b) =>
        a.from.localeCompare(b.from) ||
        a.to.localeCompare(b.to) ||
        a.reason.localeCompare(b.reason),
    ),
  }
  const result = compileMigrationProgram(cycle, {
    ...input,
    approvals: [
      ...input.approvals,
      {
        operationId: sqlOperation.id,
        decision: "custom-program",
        safety: "safe",
        findings: custom.diagnostics
          .filter((finding) => finding.operationId === sqlOperation.id)
          .map((finding) => finding.code)
          .sort(),
        reason: "Reviewed",
      },
    ],
    customPrograms: [
      {
        operationId: sqlOperation.id,
        source: "test",
        reason: "Reviewed",
        transaction: "optional",
        lock: "none",
        statements: [{ sql: "SELECT 1" }],
      },
    ],
  })
  expect(result).toMatchObject({
    ok: false,
    diagnostics: expect.arrayContaining([
      expect.objectContaining({ code: "unsupported", path: ["dependencies"] }),
    ]),
  })
})

test("recreates indexes once and validates absorbed coverage against its containing table", () => {
  const before = snapshot([table("accounts", [column("name")])])
  const after = snapshot([
    {
      ...table("accounts", [{ ...column("name"), nullable: true }]),
      indexes: [
        {
          id: "name_idx",
          kind: "index",
          physicalName: "name_idx",
          unique: false,
          candidateKey: false,
          terms: [{ kind: "column", column: "name", position: 0 }],
        },
      ],
    },
  ])
  const input = reviewed(before, after)
  const result = compileMigrationProgram(input.plan, input)
  expect(result).toMatchObject({ ok: true })
  if (!result.ok) return
  const statements = result.program.phases.flatMap((phase) => phase.statements)
  expect(statements.filter((statement) => statement.sql.startsWith("CREATE INDEX"))).toHaveLength(1)
  const phase = result.program.phases[0]!
  expect(
    validateMigrationProgram(
      {
        ...result.program,
        phases: [
          {
            ...phase,
            absorbedOperationIds: [...phase.absorbedOperationIds!, ...phase.absorbedOperationIds!],
          },
        ],
      },
      input.plan,
    ),
  ).toEqual(expect.arrayContaining([expect.objectContaining({ code: "duplicate" })]))
  expect(
    validateMigrationProgram(
      { ...result.program, phases: [{ ...phase, absorbedOperationIds: ["not-an-operation"] }] },
      input.plan,
    ),
  ).toEqual(expect.arrayContaining([expect.objectContaining({ code: "invalid-value" })]))
})

test("rejects containing table creation that would apply a skipped child", () => {
  const initial = creationPlan()
  const child = initial.operations.find((operation) => operation.kind === "column")!
  const planned = createMigrationPlan(
    diffSnapshots(snapshot(), snapshot([table("accounts", [column("name")])])),
    {
      decisions: [{ operationId: child.id, action: "skip", reason: "Keep column absent" }],
    },
  )
  expect(planned.ok).toBe(true)
  expect(compileMigrationProgram(planned.plan)).toMatchObject({
    ok: false,
    diagnostics: [
      expect.objectContaining({
        code: "unsupported",
        message: expect.stringContaining("skipped child"),
      }),
    ],
  })
})

test("rejects rebuilds that would discard table triggers", () => {
  const before = snapshot([table("accounts", [column("name")])])
  const trigger: SchemaSnapshot["triggers"][number] = {
    id: "audit",
    kind: "trigger",
    physicalName: "audit",
    table: { kind: "table", id: "accounts" },
    timing: "after",
    events: ["insert"],
    body: { kind: "expression", expressionKind: "opaque", sql: "SELECT 1" },
  }
  const source = { ...before, triggers: [trigger] }
  const target = { ...source, tables: [table("accounts", [{ ...column("name"), nullable: true }])] }
  const input = reviewed(source, target)
  expect(compileMigrationProgram(input.plan, input)).toMatchObject({
    ok: false,
    diagnostics: [
      expect.objectContaining({ code: "unsupported", path: ["afterSnapshot", "triggers"] }),
    ],
  })
})
