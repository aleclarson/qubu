import { Client } from "pg"
import postgres from "postgres"
import { diffSnapshots } from "qubu/diff"
import type { SchemaSnapshot } from "qubu/snapshot"
import { afterEach, beforeEach, describe, test } from "vitest"

import { pgMigrationAdapter } from "../../adapters/pg/src/migration.ts"
import { postgresJsMigrationAdapter } from "../../adapters/postgresjs/src/migration.ts"
import {
  compilePostgresMigrationProgram,
  sealExecutableArtifact,
} from "../../packages/migrate/src/artifact/index.ts"
import { executeMigrations } from "../../packages/migrate/src/executor/index.ts"
import { createMigrationPlan } from "../../packages/migrate/src/plan/index.ts"
import { verifyMigrationAdapterConformance } from "../../packages/migrate/src/testing/index.ts"

const liveDialects = ["postgresql", "sqlite", "mysql"] as const
const configuredDialect = process.env.QUBU_E2E_DIALECT

if (
  configuredDialect !== undefined &&
  !(liveDialects as readonly string[]).includes(configuredDialect)
) {
  throw new Error(`QUBU_E2E_DIALECT must be one of ${liveDialects.join(", ")}`)
}

const selectedDialect = configuredDialect as (typeof liveDialects)[number] | undefined
const postgresUrl = process.env.POSTGRES_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/qubu"
const tableName = "qubu_migration_profile_accounts"

async function resetFixture() {
  const client = new Client({ connectionString: postgresUrl })

  await client.connect()
  try {
    await client.query(`DROP TABLE IF EXISTS ${tableName}`)
    await client.query(
      "DROP TABLE IF EXISTS __qubu_migration_reconciliations, __qubu_migration_checkpoints, __qubu_migration_attempts, __qubu_migration_applied, __qubu_migration_metadata",
    )
  } finally {
    await client.end()
  }
}

function snapshot(names: readonly string[] = []): SchemaSnapshot {
  return {
    format: "qubu-schema",
    version: 1,
    dialect: {
      name: "postgresql",
      version: 1,
    },
    namingPolicy: {
      name: "postgres-live-test",
      version: 1,
    },
    namespace: "public",
    tables: names.map((name) => ({
      id: name,
      physicalName: name,
      columns: [
        {
          id: "value",
          physicalName: "value",
          nullable: false,
          hasDefault: false,
          generated: false,
          storage: {
            kind: "portable",
            type: "text",
          },
        },
      ],
      constraints: [],
      indexes: [],
    })),
  }
}

const expected = {
  dialect: "postgresql",
  session: "pinned",
  transactionalDdl: true,
  optionalTransactions: true,
  transactions: ["required", "optional", "forbidden"],
  lease: true,
  leaseKind: "database",
  locks: ["none", "exclusive"],
  journal: {
    storage: "database",
    compareAndSwapHead: true,
    atomicAppliedAndHead: true,
  },
  parameters: ["null", "boolean", "string", "number", "bigint", "bytes", "json"],
  commitAmbiguity: "recovery-required",
  forbiddenPhases: "checkpointed",
  features: ["tagged-parameters", "journal-head-cas", "forbidden-phases"],
} as const
const parameterProbe = {
  sql: "SELECT $1::text, $2::boolean, $3::text, $4::float8, $5::bigint, $6::bytea, $7::jsonb",
  parameters: [
    { type: "null" },
    {
      type: "boolean",
      value: true,
    },
    {
      type: "string",
      value: "bound",
    },
    {
      type: "number",
      value: "1.5",
    },
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
      value: { ok: true },
    },
  ],
} as const

describe.skipIf(selectedDialect !== "postgresql")("PostgreSQL migration profiles", () => {
  beforeEach(resetFixture, 30_000)
  afterEach(resetFixture, 30_000)

  test("runs the shared conformance probe against a pinned pg client", async () => {
    const client = new Client({ connectionString: postgresUrl })

    await client.connect()
    try {
      await verifyMigrationAdapterConformance({
        adapter: pgMigrationAdapter(client, {
          async readSnapshot() {
            return snapshot()
          },
        }),
        expected,
        parameterProbe,
      })
    } finally {
      await client.end()
    }
  })

  test("applies and atomically journals a PostgreSQL migration through pg", async () => {
    const client = new Client({ connectionString: postgresUrl })

    await client.connect()
    try {
      const before = snapshot()
      const after = snapshot([tableName])
      const planned = createMigrationPlan(diffSnapshots(before, after))

      if (!planned.ok) {
        throw new Error("Migration fixture planning failed")
      }

      const compiled = compilePostgresMigrationProgram(planned.plan)

      if (!compiled.ok) {
        throw new Error("Migration fixture compilation failed")
      }

      const artifact = await sealExecutableArtifact({
        format: "qubu-executable-migration",
        version: 1,
        id: "pg-accounts",
        sequence: 0,
        parentArtifactDigest: null,
        dialect: before.dialect,
        plan: planned.plan,
        renderer: {
          id: "qubu-postgresql",
          version: 1,
          dialect: before.dialect,
        },
        program: compiled.program,
        beforeSnapshot: { value: before },
        afterSnapshot: { value: after },
        approvals: [],
        provenance: { source: "pg-live-test" },
      })
      const adapter = pgMigrationAdapter(client, {
        async readSnapshot(_client, expected) {
          const result = await client.query(`SELECT to_regclass('${tableName}') AS value`)

          return snapshot(
            result.rows[0]?.value
              ? [tableName]
              : (expected?.tables.map((table) => table.physicalName) ?? []),
          )
        },
      })

      await executeMigrations({
        repository: [artifact],
        adapter,
      })
      await client.query(`INSERT INTO ${tableName} (value) VALUES ($1)`, ["bound"])
      const history = await client.query("SELECT artifact_id FROM __qubu_migration_applied")

      if (history.rows[0]?.artifact_id !== "pg-accounts") {
        throw new Error("PostgreSQL migration history was not advanced")
      }
    } finally {
      await client.end()
    }
  })

  test("runs the shared conformance probe against a reserved postgres.js connection", async () => {
    const sql = postgres(postgresUrl, { max: 2 })

    try {
      await verifyMigrationAdapterConformance({
        adapter: postgresJsMigrationAdapter(sql, {
          async readSnapshot() {
            return snapshot()
          },
        }),
        expected,
        parameterProbe,
      })
    } finally {
      await sql.end()
    }
  })
})
