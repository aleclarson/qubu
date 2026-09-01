import { diffSnapshots } from "qubu/diff"
import type { SchemaSnapshot } from "qubu/snapshot"
import { expect, test } from "vitest"

import {
  ArtifactValidationError,
  canonicalText,
  decodeBaselineArtifact,
  decodeExecutableArtifact,
  digestCanonical,
  encodeBaselineArtifact,
  encodeCanonical,
  encodeExecutableArtifact,
  sealBaselineArtifact,
  sealExecutableArtifact,
  type MigrationProgram,
  type OperationApproval,
  type UnsealedExecutableMigrationArtifact,
} from "../src/artifact/index.ts"
import { createMigrationPlan, type MigrationPlan } from "../src/plan/index.ts"

const dialect = {
  name: "sqlite",
  version: 1,
} as const

function snapshot(tables: SchemaSnapshot["tables"] = []): SchemaSnapshot {
  return {
    format: "qubu-schema",
    version: 1,
    dialect,
    namingPolicy: {
      name: "test",
      version: 1,
    },
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

function table(): SchemaSnapshot["tables"][number] {
  return {
    kind: "table",
    id: "accounts",
    physicalName: "accounts",
    columns: [],
    constraints: [],
    indexes: [],
  }
}

function plan(unsafe = false): MigrationPlan {
  const before = unsafe ? snapshot([table()]) : snapshot()
  const after = unsafe ? snapshot() : snapshot([table()])
  const first = createMigrationPlan(diffSnapshots(before, after))

  if (first.ok) {
    return first.plan
  }

  const resolved = createMigrationPlan(diffSnapshots(before, after), {
    decisions: first.plan.operations.map((operation) => ({
      action: "allow",
      operationId: operation.id,
      reason: "Reviewed exact removal",
    })),
  })

  return resolved.plan
}

function program(value: MigrationPlan, withParameter = false): MigrationProgram {
  const operationId = value.operations[0]!.id

  return {
    format: "qubu-migration-program",
    version: 1,
    phases: [
      {
        id: "main",
        position: 0,
        transaction: "required",
        lock: "exclusive",
        dependsOn: [],
        statements: [
          {
            id: "create-accounts",
            position: 0,
            operationId,
            sql: "CREATE TABLE accounts (id INTEGER)",
            dependsOn: [],
            parameters: withParameter
              ? [
                  {
                    type: "bigint",
                    value: "42",
                  },
                  {
                    type: "bytes",
                    base64: "AQI=",
                  },
                  {
                    type: "json",
                    value: { role: "admin" },
                  },
                ]
              : [],
          },
        ],
        preconditions: [],
        postconditions: [
          {
            id: "accounts-present",
            type: "object-present",
            value: { table: "accounts" },
          },
        ],
      },
    ],
  }
}

function executable(unsafe = false, withParameter = false): UnsealedExecutableMigrationArtifact {
  const migrationPlan = plan(unsafe)
  const approvals: OperationApproval[] = unsafe
    ? migrationPlan.operations
        .map((operation) => ({
          operationId: operation.id,
          decision: "approve" as const,
          safety: operation.safety,
          findings: migrationPlan.diagnostics
            .filter((finding) => finding.operationId === operation.id)
            .map((finding) => finding.code)
            .sort(),
          reason: "Reviewed exact removal",
        }))
        .sort((a, b) => a.operationId.localeCompare(b.operationId))
    : []

  return {
    format: "qubu-executable-migration",
    version: 1,
    id: unsafe ? "drop-accounts" : "create-accounts",
    sequence: 0,
    parentArtifactDigest: null,
    dialect,
    plan: migrationPlan,
    renderer: {
      id: "qubu-sqlite",
      version: 1,
      dialect,
    },
    program: program(migrationPlan, withParameter),
    beforeSnapshot: { value: unsafe ? snapshot([table()]) : snapshot() },
    afterSnapshot: { value: unsafe ? snapshot() : snapshot([table()]) },
    approvals,
    provenance: {
      source: "unit-test",
      revision: "abc123",
    },
  }
}

test("uses canonical UTF-8 LF bytes and stable domain-separated SHA-256 golden vectors", async () => {
  expect(
    canonicalText({
      z: 1,
      a: "é",
    }),
  ).toBe('{"a":"é","z":1}\n')
  expect(
    new TextDecoder().decode(
      encodeCanonical({
        z: 1,
        a: "é",
      }),
    ),
  ).toBe('{"a":"é","z":1}\n')
  expect(await digestCanonical("migration-plan", { a: 1 })).toBe(
    "sha256:70e6ddccca9dc0ea71da3e7364da17a3a95187deffa6151253063c96220f71c3",
  )
  expect(await digestCanonical("artifact", { a: 1 })).not.toBe(
    await digestCanonical("migration-plan", { a: 1 }),
  )
})

test("seals and strictly round-trips a fully covered executable artifact", async () => {
  const artifact = await sealExecutableArtifact(executable(false, true))
  const encoded = encodeExecutableArtifact(artifact)
  const decoded = await decodeExecutableArtifact(encoded)

  expect(decoded).toEqual({
    ok: true,
    value: artifact,
  })
  expect(encoded.endsWith("\n")).toBe(true)
  expect(artifact.planDigest).toMatch(/^sha256:/)
  expect(artifact.programDigest).toMatch(/^sha256:/)
  expect(Object.isFrozen(artifact.program.phases[0])).toBe(true)
})

test("fails closed for non-canonical bytes, unknown keys, versions, and tampering", async () => {
  const artifact = await sealExecutableArtifact(executable())

  expect((await decodeExecutableArtifact(JSON.stringify(artifact))).ok).toBe(false)
  expect(
    (
      await decodeExecutableArtifact({
        ...artifact,
        surprise: true,
      })
    ).ok,
  ).toBe(false)
  const version = await decodeExecutableArtifact({
    ...artifact,
    version: 2,
  })

  expect(version.ok ? [] : version.diagnostics.map((item) => item.code)).toContain(
    "unsupported-version",
  )
  const tampered = await decodeExecutableArtifact({
    ...artifact,
    provenance: { source: "tampered" },
  })

  expect(tampered.ok ? [] : tampered.diagnostics.map((item) => item.code)).toContain(
    "digest-mismatch",
  )
})

test("requires exact operation-scoped approval for destructive operations", async () => {
  await expect(
    sealExecutableArtifact({
      ...executable(true),
      approvals: [],
    }),
  ).rejects.toBeInstanceOf(ArtifactValidationError)
  await expect(sealExecutableArtifact(executable(true))).resolves.toMatchObject({
    id: "drop-accounts",
  })
})

test("rejects malformed tagged parameters", async () => {
  const input = executable(false, true)
  const phase = input.program.phases[0]!
  const statement = phase.statements[0]!
  const malformed = {
    ...input,
    program: {
      ...input.program,
      phases: [
        {
          ...phase,
          statements: [
            {
              ...statement,
              parameters: [
                {
                  type: "number",
                  value: "NaN",
                },
              ],
            },
          ],
        },
      ],
    },
  }

  await expect(
    sealExecutableArtifact(malformed as UnsealedExecutableMigrationArtifact),
  ).rejects.toBeInstanceOf(ArtifactValidationError)
})

test("seals a verified baseline without a fake plan or program", async () => {
  const baseline = await sealBaselineArtifact({
    format: "qubu-verified-baseline",
    version: 1,
    id: "initial",
    sequence: 0,
    parentArtifactDigest: null,
    dialect,
    snapshot: { value: snapshot() },
    verifiedAt: "2026-08-29T12:00:00.000Z",
    provenance: { source: "live-introspection" },
  })
  const decoded = await decodeBaselineArtifact(encodeBaselineArtifact(baseline))

  expect(decoded).toEqual({
    ok: true,
    value: baseline,
  })
  expect("program" in baseline).toBe(false)
})
