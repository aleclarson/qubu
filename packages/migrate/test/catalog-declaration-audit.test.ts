import { diffSnapshots } from "qubu/diff"
import {
  mapCatalogToCompleteSnapshot,
  type CatalogConnection,
  type CatalogQuery,
  type CatalogQueryRow,
} from "qubu/introspection"
import {
  postgresColumnsQuery,
  postgresRelationsQuery,
  postgresRoutinesQuery,
  postgresServerQuery,
  postgresTriggersQuery,
  readCatalog,
} from "qubu/introspection/postgres"
import type { SchemaSnapshot } from "qubu/snapshot"
import { expect, test } from "vitest"

import { emitMigrationPlan } from "../src/ddl/postgres.ts"
import { createMigrationPlan } from "../src/plan/index.ts"

function catalogConnection(): CatalogConnection {
  const rows = new Map<string, readonly CatalogQueryRow[]>([
    [
      postgresServerQuery,
      [
        {
          server_version_num: "170000",
          server_version: "17.0",
        },
      ],
    ],
    [
      postgresRelationsQuery,
      [
        {
          oid: "10",
          namespace: "public",
          relname: "records",
          relkind: "r",
        },
      ],
    ],
    [
      postgresColumnsQuery,
      [
        {
          table_oid: "10",
          ordinal_position: 1,
          physical_name: "value",
          nullable: false,
          native_type: "integer",
        },
      ],
    ],
    [
      postgresTriggersQuery,
      [
        {
          oid: "20",
          table_oid: "10",
          namespace: "public",
          physical_name: "audit_guard",
          trigger_type: 19,
          tgenabled: "O",
          definition:
            "CREATE TRIGGER audit_guard BEFORE UPDATE ON public.records FOR EACH ROW EXECUTE FUNCTION private.audit_record()",
        },
      ],
    ],
    [
      postgresRoutinesQuery,
      [
        {
          oid: "30",
          namespace: "public",
          physical_name: "audit_value",
          prokind: "f",
          return_type: "integer",
          language: "sql",
          definition:
            "CREATE OR REPLACE FUNCTION public.audit_value() RETURNS integer LANGUAGE sql AS $function$ SELECT 1 $function$",
        },
      ],
    ],
  ])

  return {
    dialect: "postgresql",
    async query<TRow extends CatalogQueryRow = CatalogQueryRow>(statement: CatalogQuery) {
      return (rows.get(statement.text) ?? []) as readonly TRow[]
    },
  }
}

test.each([
  {
    kind: "trigger",
    representation: "catalog",
  },
  {
    kind: "trigger",
    representation: "body",
  },
  {
    kind: "function",
    representation: "catalog",
  },
  {
    kind: "function",
    representation: "body",
  },
] as const)(
  "emits one PostgreSQL $kind declaration using its $representation representation",
  async ({ kind, representation }) => {
    const catalog = await readCatalog(catalogConnection(), { namespace: "public" })
    const mapped = mapCatalogToCompleteSnapshot(catalog)

    expect(mapped.ok, JSON.stringify(mapped.diagnostics)).toBe(true)
    if (!mapped.ok) {
      return
    }

    let after: SchemaSnapshot = mapped.snapshot

    if (representation === "body") {
      // Direct body expressions are the control for catalog-provided full DDL.
      after = {
        ...after,
        triggers: after.triggers.map((trigger) => ({
          ...trigger,
          body: {
            kind: "expression",
            expressionKind: "raw",
            sql: "EXECUTE FUNCTION private.audit_record()",
          },
        })),
        routines: after.routines.map((routine) => ({
          ...routine,
          body: {
            kind: "expression",
            expressionKind: "raw",
            sql: "SELECT 1",
          },
        })),
      }
    }

    const before: SchemaSnapshot = {
      ...after,
      ...(kind === "trigger" ? { triggers: [] } : { routines: [] }),
    }
    const planned = createMigrationPlan(diffSnapshots(before, after), { allowReviewRequired: true })

    expect(planned.ok, JSON.stringify(planned.diagnostics)).toBe(true)
    const emitted = emitMigrationPlan(planned.plan, { afterSnapshot: after })

    expect(emitted.ok, JSON.stringify(emitted.diagnostics)).toBe(true)
    // Full decompiler output must be emitted directly or normalized before it
    // is embedded. It must never become the body of a second CREATE statement.
    const declaration =
      kind === "trigger"
        ? /\bCREATE(?: OR REPLACE)? TRIGGER\b/gi
        : /\bCREATE(?: OR REPLACE)? FUNCTION\b/gi

    expect(emitted.sql.match(declaration)).toHaveLength(1)
  },
)
