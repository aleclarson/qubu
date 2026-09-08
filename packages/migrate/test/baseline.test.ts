import type { SchemaSnapshot } from "qubu/snapshot"
import { expect, test, vi } from "vitest"

import {
  captureBaseline,
  compareManagedSnapshots,
  createBaseline,
  fromMigrationAdapter,
  type BaselineAdapter,
  type BaselineConfirmation,
} from "../src/baseline/index.ts"
import { DeterministicFakeMigrationAdapter } from "../src/testing/index.ts"

function snapshot(withTable = false): SchemaSnapshot {
  return {
    format: "qubu-schema",
    version: 1,
    dialect: {
      name: "sqlite",
      version: 1,
    },
    namingPolicy: {
      name: "test",
      version: 1,
    },
    namespace: {
      kind: "sqlite-database",
      name: "main",
    },
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
    tables: withTable
      ? [
          {
            kind: "table",
            id: "accounts",
            physicalName: "accounts",
            columns: [],
            constraints: [],
            indexes: [],
          },
        ]
      : [],
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

const confirmation: BaselineConfirmation = {
  databaseTargetVerified: true,
  snapshotSourceVerified: true,
  zeroManagedDriftVerified: true,
  backupRestoreReady: true,
  otherMigratorsStopped: true,
  incompatibleApplicationPrevented: true,
  legacyHistoryCutoverAccepted: true,
}

test("preserves inspection failures while closing an adoption-only session", async () => {
  const failure = new Error("inspection failed")
  const close = vi.fn(async () => {
    throw new Error("cleanup failed")
  })
  const adapter: BaselineAdapter = {
    async openBaselineSession() {
      return {
        dialect: "sqlite",
        async readSnapshot() {
          throw failure
        },
        async assertEmptyHistory() {},
        async recordBaseline() {},
        close,
      }
    },
  }

  await expect(
    captureBaseline({
      adapter,
      scope: snapshot(),
    }),
  ).rejects.toBe(failure)
  expect(close).toHaveBeenCalledOnce()
})

test("closes the migration session even when releasing the adoption lease fails", async () => {
  const fake = new DeterministicFakeMigrationAdapter({ snapshotDigest: `sha256:${"0".repeat(64)}` })
  const adapter = fromMigrationAdapter({
    async openMigrationSession() {
      const session = await fake.openMigrationSession()

      return {
        ...session,
        async readSnapshot() {
          return {
            snapshot: snapshot(),
            unmanagedObjects: [],
          }
        },
        async releaseLease() {
          await session.releaseLease()
          throw new Error("release failed")
        },
      }
    },
  })

  await expect(
    captureBaseline({
      adapter,
      scope: snapshot(),
    }),
  ).rejects.toThrow("release failed")
  expect(fake.events.filter((event) => event === "close-session")).toHaveLength(1)
})

test("reports a lost baseline commit response as uncertain even when rollback succeeds", async () => {
  const fake = new DeterministicFakeMigrationAdapter({
    snapshotDigest: `sha256:${"0".repeat(64)}`,
    classifyFailure: "uncertain",
  })
  const scope = snapshot()
  const adapter = fromMigrationAdapter({
    async openMigrationSession() {
      const session = await fake.openMigrationSession()

      return {
        ...session,
        async readSnapshot() {
          return {
            snapshot: scope,
            unmanagedObjects: [],
          }
        },
        async commitTransaction() {
          await session.commitTransaction()
          throw new Error("commit response lost")
        },
      }
    },
  })

  await expect(
    createBaseline({
      adapter,
      scope,
      candidate: scope,
      repository: [],
      id: "initial",
      provenance: { source: "test" },
      confirmation,
    }),
  ).rejects.toMatchObject({ code: "uncertain-outcome" })
  expect(await fake.journal.listApplied()).toHaveLength(1)
  expect((await fake.journal.listAttempts())[0]?.state).not.toBe("rolled_back")
  expect(fake.events).toContain("close-session")
})

function managedFixture(suffix = ""): SchemaSnapshot {
  const tableId = `accounts${suffix}`
  const columnId = `id${suffix}`

  return {
    ...snapshot(),
    tables: [
      {
        kind: "table",
        id: tableId,
        physicalName: "accounts",
        columns: [
          {
            kind: "column",
            id: columnId,
            physicalName: "account_id",
            ordinalPosition: 1,
            nullable: false,
            hasDefault: false,
            generated: false,
            storage: {
              kind: "native",
              dialect: "sqlite",
              type: "INTEGER",
              affinity: "integer",
            },
          },
          {
            kind: "column",
            id: `other${suffix}`,
            physicalName: "other_id",
            ordinalPosition: 2,
            nullable: false,
            hasDefault: false,
            generated: false,
            storage: {
              kind: "native",
              dialect: "sqlite",
              type: "INTEGER",
              affinity: "integer",
            },
          },
        ],
        constraints: [
          {
            kind: "primary-key",
            id: `pk${suffix}`,
            physicalName: "accounts_pk",
            columns: [columnId],
          },
          {
            kind: "foreign-key",
            id: `fk${suffix}`,
            physicalName: "accounts_fk",
            columns: [columnId],
            target: {
              table: {
                kind: "table",
                id: tableId,
              },
              columns: [columnId],
            },
          },
        ],
        indexes: [
          {
            kind: "index",
            id: `idx${suffix}`,
            physicalName: "accounts_idx",
            unique: false,
            candidateKey: false,
            terms: [
              {
                kind: "column",
                column: columnId,
                position: 1,
              },
            ],
          },
        ],
      },
    ],
  }
}

function withCreateSql(snapshot: SchemaSnapshot): SchemaSnapshot {
  return {
    ...snapshot,
    opaqueObjects: [
      {
        kind: "opaque-object",
        id: "observed-create",
        objectKind: "unknown-field",
        physicalName: "accounts",
        data: {
          ownerKind: "table",
          ownerId: snapshot.tables[0]!.id,
          field: "createSql",
          value: "CREATE TABLE accounts (account_id INTEGER)",
        },
      },
    ],
  }
}

test("compares equivalent managed facts without logical identity or CREATE SQL churn", () => {
  const expected = managedFixture()
  const observed = managedFixture("Observed")
  const actual: SchemaSnapshot = withCreateSql({
    ...observed,
    tables: observed.tables.map((table) => ({
      ...table,
      constraints: table.constraints.map((constraint) =>
        constraint.kind === "foreign-key"
          ? {
              ...constraint,
              onUpdate: "no-action",
              onDelete: "no-action",
              match: "simple",
            }
          : constraint,
      ),
    })),
  })
  const comparison = compareManagedSnapshots(expected, actual)

  expect(comparison.matches, JSON.stringify(comparison)).toBe(true)
  expect(comparison.operations).toEqual([])
  expect(comparison.diagnostics).toEqual([])
})

test.each([
  "column",
  "index",
  "constraint",
  "foreign-key",
  "foreign-key-target",
  "constraint-kind",
  "missing-constraint",
  "unknown-field",
  "opaque",
] as const)(
  "reports changed %s facts without unrelated CREATE SQL or logical identity churn",
  (change) => {
    const expected = managedFixture()
    const observed = managedFixture("Observed")
    const table = observed.tables[0]!
    let actual = withCreateSql(observed)

    if (change === "column") {
      actual = {
        ...actual,
        tables: [
          { ...table, columns: table.columns.map((column) => ({ ...column, nullable: true })) },
        ],
      }
    }
    if (change === "index") {
      actual = {
        ...actual,
        tables: [{ ...table, indexes: table.indexes.map((index) => ({ ...index, unique: true })) }],
      }
    }
    if (change === "constraint") {
      actual = {
        ...actual,
        tables: [
          {
            ...table,
            constraints: table.constraints.map((constraint) =>
              constraint.kind === "primary-key"
                ? { ...constraint, physicalName: "renamed_pk" }
                : constraint,
            ),
          },
        ],
      }
    }
    if (change === "foreign-key") {
      actual = {
        ...actual,
        tables: [
          {
            ...table,
            constraints: table.constraints.map((constraint) =>
              constraint.kind === "foreign-key"
                ? { ...constraint, onDelete: "cascade" }
                : constraint,
            ),
          },
        ],
      }
    }
    if (change === "foreign-key-target") {
      actual = {
        ...actual,
        tables: [
          {
            ...table,
            constraints: table.constraints.map((constraint) =>
              constraint.kind === "foreign-key"
                ? { ...constraint, target: { ...constraint.target, columns: ["otherObserved"] } }
                : constraint,
            ),
          },
        ],
      }
    }
    if (change === "constraint-kind") {
      actual = {
        ...actual,
        tables: [
          {
            ...table,
            constraints: table.constraints.map((constraint) =>
              constraint.kind === "primary-key" ? { ...constraint, kind: "unique" } : constraint,
            ),
          },
        ],
      }
    }
    if (change === "missing-constraint") {
      actual = {
        ...actual,
        tables: [
          {
            ...table,
            constraints: table.constraints.filter(
              (constraint) => constraint.kind !== "foreign-key",
            ),
          },
        ],
      }
    }
    if (change === "unknown-field" || change === "opaque") {
      actual = {
        ...actual,
        opaqueObjects: [
          ...actual.opaqueObjects,
          {
            kind: "opaque-object",
            id: "unknown",
            objectKind: change === "opaque" ? "trigger" : "unknown-field",
            physicalName: "accounts",
            data: { ownerKind: "table", ownerId: table.id, field: "strict", value: true },
          },
        ],
      }
    }
    const comparison = compareManagedSnapshots(expected, actual)

    expect(comparison.matches, JSON.stringify(comparison)).toBe(false)
    expect(comparison.operations.length).toBeGreaterThan(0)
    expect(
      comparison.operations.every((operation) => operation.logicalId !== "observed-create"),
    ).toBe(true)
    const kind =
      change === "column" || change === "index"
        ? change
        : change === "unknown-field" || change === "opaque"
          ? "opaque-object"
          : "constraint"

    expect(
      comparison.operations.every((operation) => operation.kind === kind),
      JSON.stringify(comparison),
    ).toBe(true)
  },
)

test("retains unknown facts that replace CREATE SQL metadata with the same identity", () => {
  const expected = withCreateSql(managedFixture())
  const actual: SchemaSnapshot = {
    ...expected,
    opaqueObjects: expected.opaqueObjects.map((object) => ({
      ...object,
      data: {
        ownerKind: "table",
        ownerId: "accounts",
        field: "strict",
        value: true,
      },
    })),
  }
  const comparison = compareManagedSnapshots(expected, actual)

  expect(comparison.matches).toBe(false)
  expect(comparison.operations).toHaveLength(1)
  expect(comparison.operations[0]?.type).toBe("add")
  expect(comparison.diagnostics.some((diagnostic) => diagnostic.code === "unsupported")).toBe(true)
})

test("retains invalid snapshot diagnostics before excluding introspection metadata", () => {
  const invalid = {
    ...withCreateSql(managedFixture()),
    version: 999,
  } as unknown as SchemaSnapshot
  const comparison = compareManagedSnapshots(managedFixture(), invalid)

  expect(comparison.matches).toBe(false)
  expect(comparison.diagnostics.some((diagnostic) => diagnostic.code === "invalid-snapshot")).toBe(
    true,
  )
})

test("reports only changed physical properties for matched logical identities", () => {
  const expected = managedFixture()
  const actual = withCreateSql({
    ...expected,
    tables: expected.tables.map((table) => ({
      ...table,
      columns: table.columns.map((column) => ({
        ...column,
        nullable: true,
        storage: {
          kind: "native" as const,
          dialect: "sqlite",
          type: " integer ",
          affinity: "integer",
        },
      })),
      constraints: table.constraints.map((constraint) =>
        constraint.kind === "foreign-key"
          ? {
              ...constraint,
              onDelete: "no-action",
              onUpdate: "no-action",
              match: "simple",
            }
          : constraint,
      ),
    })),
  })
  const comparison = compareManagedSnapshots(expected, actual)

  expect(comparison.matches).toBe(false)
  expect(comparison.operations).toHaveLength(2)
  for (const operation of comparison.operations) {
    expect(operation.kind).toBe("column")
    expect(operation.changedProperties).toEqual([
      {
        path: ["nullable"],
        before: false,
        after: true,
      },
    ])
  }
})
