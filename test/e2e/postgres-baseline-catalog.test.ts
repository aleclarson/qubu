import { Client } from "pg"
import { integer, schema, table } from "qubu"
import { diffSnapshots } from "qubu/diff"
import {
  canonicalizeCompleteSchemaSnapshot,
  encodeSchemaSnapshot,
  type SchemaSnapshot,
} from "qubu/snapshot"
import { createSchemaSnapshot } from "qubu/snapshot/postgres"
import { expect, test } from "vitest"

import { migrationAdapter, readMigrationSnapshot } from "../../adapters/pg/src/migration.ts"
import { sealExecutableArtifact } from "../../packages/migrate/src/artifact/index.ts"
import { compileMigrationProgram } from "../../packages/migrate/src/artifact/postgres.ts"
import { fromMigrationAdapter } from "../../packages/migrate/src/baseline/index.ts"
import {
  captureBaseline,
  createBaseline,
  preflightBaseline,
} from "../../packages/migrate/src/baseline/index.ts"
import { executeMigrations } from "../../packages/migrate/src/executor/index.ts"
import { createMigrationPlan } from "../../packages/migrate/src/plan/index.ts"

const postgres = process.env.QUBU_E2E_DIALECT === "postgresql"

test.runIf(postgres)(
  "adopts actual PostgreSQL catalog facts and migrates the accepted baseline",
  async () => {
    const client = new Client({
      connectionString:
        process.env.POSTGRES_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/qubu",
    })
    const namespace = `qubu_adoption_${crypto.randomUUID().replaceAll("-", "")}`

    await client.connect()
    try {
      await client.query(`CREATE SCHEMA ${namespace}`)
      await client.query(`SET search_path TO ${namespace}`)
      await client.query(
        "CREATE TABLE game (id integer PRIMARY KEY, title text NOT NULL DEFAULT 'untitled')",
      )
      await client.query("COMMENT ON TABLE game IS 'Existing game catalog'")
      await client.query(
        "CREATE TABLE external (id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY)",
      )
      // The configured namespace is independent of the default reader's public fallback.
      const selection = {
        ...createSchemaSnapshot(schema({ game: table("game", { id: integer() }) })),
        namespace: {
          kind: "postgres-schema" as const,
          name: namespace,
        },
      }
      const all = await readMigrationSnapshot(client, selection)
      const game = all.snapshot.tables[0]!
      const scope: SchemaSnapshot = canonicalizeCompleteSchemaSnapshot({
        ...all.snapshot,
        tables: [
          {
            ...game,
            columns: [
              game.columns[0]!,
              {
                kind: "column",
                id: "manifest",
                physicalName: "manifest",
                ordinalPosition: 3,
                nullable: true,
                hasDefault: false,
                generated: false,
                storage: {
                  kind: "native",
                  dialect: "postgresql",
                  type: "text",
                },
              },
              game.columns[1]!,
            ],
          },
        ],
      })
      const adapter = migrationAdapter(client)
      const capture = await captureBaseline({
        adapter: fromMigrationAdapter(adapter),
        scope,
      })

      expect(capture.snapshot.tables[0]!.id).toBe("game")
      expect(capture.snapshot.tables[0]!.columns.map((column) => column.physicalName)).toEqual([
        "id",
        "title",
      ])
      expect(capture.snapshot.tables[0]!.columns[1]!.default).toEqual(game.columns[1]!.default)
      expect(capture.snapshot.tables[0]!.constraints).toEqual(game.constraints)
      expect(capture.snapshot.sequences).toEqual([])
      expect(capture.unmanagedObjects).toEqual([
        {
          kind: "table",
          physicalName: "external",
        },
      ])
      expect(encodeSchemaSnapshot(capture.snapshot)).not.toContain("__qubu_migration_")
      expect(
        encodeSchemaSnapshot(
          (
            await captureBaseline({
              adapter: fromMigrationAdapter(adapter),
              scope,
            })
          ).snapshot,
        ),
      ).toBe(encodeSchemaSnapshot(capture.snapshot))
      await preflightBaseline({
        adapter: fromMigrationAdapter(adapter),
        scope,
        candidate: capture.snapshot,
        repository: [],
      })
      await client.query("ALTER TABLE game ADD COLUMN changed boolean")
      await expect(
        preflightBaseline({
          adapter: fromMigrationAdapter(adapter),
          scope,
          candidate: capture.snapshot,
          repository: [],
        }),
      ).rejects.toThrow()
      await client.query("ALTER TABLE game DROP COLUMN changed")
      const accepted = await createBaseline({
        adapter: fromMigrationAdapter(adapter),
        scope,
        candidate: capture.snapshot,
        repository: [],
        id: "initial",
        provenance: { source: "postgres-adoption-test" },
        confirmation: {
          databaseTargetVerified: true,
          snapshotSourceVerified: true,
          zeroManagedDriftVerified: true,
          backupRestoreReady: true,
          otherMigratorsStopped: true,
          incompatibleApplicationPrevented: true,
          legacyHistoryCutoverAccepted: true,
        },
      })
      const plan = createMigrationPlan(diffSnapshots(accepted.artifact.snapshot.value!, scope))

      if (!plan.ok) {
        throw new Error(JSON.stringify(plan.diagnostics))
      }

      const compiled = compileMigrationProgram(plan.plan)

      if (!compiled.ok) {
        throw new Error(JSON.stringify(compiled.diagnostics))
      }

      const artifact = await sealExecutableArtifact({
        format: "qubu-executable-migration",
        version: 1,
        id: "add-manifest",
        sequence: 1,
        parentArtifactDigest: accepted.artifact.artifactDigest,
        dialect: scope.dialect,
        plan: plan.plan,
        renderer: {
          id: "qubu-postgresql",
          version: 1,
          dialect: scope.dialect,
        },
        program: compiled.program,
        beforeSnapshot: accepted.artifact.snapshot,
        afterSnapshot: { value: scope },
        approvals: [],
        provenance: { source: "postgres-adoption-test" },
      })

      await executeMigrations({
        adapter,
        repository: [accepted.artifact, artifact],
      })
      await client.query("INSERT INTO game (id, manifest) VALUES ($1, $2)", [
        1,
        "captured then migrated",
      ])
      expect((await client.query("SELECT manifest FROM game WHERE id = 1")).rows[0]?.manifest).toBe(
        "captured then migrated",
      )
      expect(
        (
          await client.query("SELECT kind FROM __qubu_migration_applied ORDER BY sequence")
        ).rows.map((row) => row.kind),
      ).toEqual(["baseline", "migration"])
    } finally {
      await client.query(`DROP SCHEMA IF EXISTS ${namespace} CASCADE`)
      await client.end()
    }
  },
  30_000,
)
