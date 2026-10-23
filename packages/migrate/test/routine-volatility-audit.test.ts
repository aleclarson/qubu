import { schema } from "qubu"
import { diffSnapshots } from "qubu/diff"
import { createSchemaSnapshot, type SchemaSnapshot } from "qubu/snapshot"
import { postgresSchemaDialect } from "qubu/snapshot/postgres"
import { expect, test } from "vitest"

import { emitMigrationPlan } from "../src/ddl/postgres.ts"
import { createMigrationPlan } from "../src/plan/index.ts"

test.each(["immutable", "volatile", undefined] as const)(
  "preserves PostgreSQL function index eligibility (volatility: %s)",
  (volatility) => {
    const before = createSchemaSnapshot(schema({}, { namespace: "public" }), {
      dialect: postgresSchemaDialect,
    })
    const after: SchemaSnapshot = {
      ...before,
      routines: [
        {
          kind: "routine",
          id: "normalize_key",
          physicalName: "normalize_key",
          routineKind: "function",
          parameters: [
            {
              name: "value",
              mode: "in",
              ordinalPosition: 1,
              storage: {
                kind: "native",
                dialect: "postgresql",
                type: "text",
              },
            },
          ],
          returnType: {
            kind: "native",
            dialect: "postgresql",
            type: "text",
          },
          language: "plpgsql",
          ...(volatility === undefined ? {} : { volatility }),
          body: {
            kind: "expression",
            expressionKind: "raw",
            sql: "BEGIN RETURN lower(value); END",
          },
        },
      ],
    }
    const planned = createMigrationPlan(diffSnapshots(before, after), {
      allowReviewRequired: true,
    })

    expect(planned.ok, JSON.stringify(planned.diagnostics)).toBe(true)
    const emitted = emitMigrationPlan(planned.plan, { afterSnapshot: after })

    expect(emitted.ok, JSON.stringify(emitted.diagnostics)).toBe(true)
    expect(emitted.statements).toHaveLength(1)
    expect(emitted.sql).toContain('CREATE FUNCTION "public"."normalize_key"')
    if (volatility === "immutable") {
      // PostgreSQL rejects expression indexes if this defaults to VOLATILE.
      expect(emitted.sql).toMatch(/\bIMMUTABLE\b/u)
    } else {
      // Omitting volatility preserves PostgreSQL's default VOLATILE behavior.
      expect(emitted.sql).not.toMatch(/\b(?:IMMUTABLE|STABLE)\b/u)
    }
  },
)
