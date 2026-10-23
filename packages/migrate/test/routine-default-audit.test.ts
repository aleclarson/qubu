import { schema } from "qubu"
import { diffSnapshots } from "qubu/diff"
import { createSchemaSnapshot, type SchemaSnapshot } from "qubu/snapshot"
import { postgresSchemaDialect } from "qubu/snapshot/postgres"
import { expect, test } from "vitest"

import { emitMigrationPlan } from "../src/ddl/postgres.ts"
import { createMigrationPlan } from "../src/plan/index.ts"

test.each([false, true])(
  "preserves PostgreSQL function argument optionality (defaulted: %s)",
  (defaulted) => {
    const before = createSchemaSnapshot(schema({}, { namespace: "public" }), {
      dialect: postgresSchemaDialect,
    })
    const after: SchemaSnapshot = {
      ...before,
      routines: [
        {
          kind: "routine",
          id: "default_quota",
          physicalName: "default_quota",
          routineKind: "function",
          parameters: [
            {
              name: "quota",
              mode: "in",
              ordinalPosition: 1,
              storage: {
                kind: "native",
                dialect: "postgresql",
                type: "integer",
              },
              ...(defaulted
                ? {
                    default: {
                      kind: "literal" as const,
                      value: {
                        kind: "number" as const,
                        value: "7",
                      },
                    },
                  }
                : {}),
            },
          ],
          returnType: {
            kind: "native",
            dialect: "postgresql",
            type: "integer",
          },
          language: "sql",
          body: {
            kind: "expression",
            expressionKind: "raw",
            sql: "SELECT quota",
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
    if (defaulted) {
      // Losing the default makes SELECT default_quota() fail to resolve.
      expect(emitted.sql).toMatch(/"quota"\s+integer\s+(?:DEFAULT|=)\s+7/iu)
    } else {
      expect(emitted.sql).toContain('"quota" integer)')
      expect(emitted.sql).not.toMatch(/\bDEFAULT\b/iu)
    }
  },
)
