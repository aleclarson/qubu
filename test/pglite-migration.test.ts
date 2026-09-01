import { PGlite } from "@electric-sql/pglite"
import type { SchemaSnapshot } from "qubu/snapshot"
import { afterEach, test } from "vitest"

import { pgliteMigrationAdapter } from "../adapters/pglite/src/migration.ts"
import { verifyMigrationAdapterConformance } from "../packages/migrate/src/testing/index.ts"

const databases: PGlite[] = []

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()))
})

function snapshot(): SchemaSnapshot {
  return {
    format: "qubu-schema",
    version: 2,
    dialect: {
      name: "postgresql",
      version: 1,
    },
    namingPolicy: {
      name: "pglite-live-test",
      version: 1,
    },
    namespace: { kind: "postgres-schema", name: "public" },
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
    tables: [],
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

test("runs the shared conformance probe against a pinned PGlite session", async () => {
  const database = new PGlite()

  databases.push(database)
  await verifyMigrationAdapterConformance({
    adapter: pgliteMigrationAdapter(database, {
      async readSnapshot() {
        return snapshot()
      },
    }),
    expected: {
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
    },
    parameterProbe: {
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
    },
  })
})
