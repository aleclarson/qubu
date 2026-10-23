import { schema } from "qubu"
import { diffSnapshots } from "qubu/diff"
import { createSchemaSnapshot, type SchemaSnapshot } from "qubu/snapshot"
import { postgresSchemaDialect } from "qubu/snapshot/postgres"
import { expect, test } from "vitest"

import { emitMigrationPlan } from "../src/ddl/postgres.ts"
import { createMigrationPlan } from "../src/plan/index.ts"

function routine(type: "integer" | "text"): SchemaSnapshot["routines"][number] {
  return {
    kind: "routine",
    id: `lookup_${type}`,
    physicalName: "lookup",
    routineKind: "function",
    parameters: [
      {
        name: "input",
        mode: "in",
        ordinalPosition: 1,
        storage: {
          kind: "native",
          dialect: "postgresql",
          type,
        },
      },
    ],
    returnType: {
      kind: "native",
      dialect: "postgresql",
      type: "text",
    },
    language: "sql",
    body: {
      kind: "expression",
      expressionKind: "raw",
      sql: "SELECT input::text",
    },
  }
}

for (const operation of ["remove", "replace"] as const) {
  test.each([false, true])(
    `targets the PostgreSQL integer function during ${operation} (overloaded: %s)`,
    (overloaded) => {
      const base = createSchemaSnapshot(schema({}, { namespace: "public" }), {
        dialect: postgresSchemaDialect,
      })
      const target = routine("integer")
      const retained = overloaded ? [routine("text")] : []
      const before: SchemaSnapshot = {
        ...base,
        routines: [target, ...retained],
      }
      const after: SchemaSnapshot = {
        ...base,
        routines:
          operation === "remove"
            ? retained
            : [
                {
                  ...target,
                  body: {
                    kind: "expression",
                    expressionKind: "raw",
                    sql: "SELECT (input + 1)::text",
                  },
                },
                ...retained,
              ],
      }
      const planned = createMigrationPlan(diffSnapshots(before, after), {
        allowDestructive: true,
        allowReviewRequired: true,
      })

      expect(planned.ok, JSON.stringify(planned.diagnostics)).toBe(true)
      const emitted = emitMigrationPlan(planned.plan, {
        afterSnapshot: after,
        allowDestructive: true,
      })

      expect(emitted.ok, JSON.stringify(emitted.diagnostics)).toBe(true)
      expect(emitted.statements).toHaveLength(1)
      if (overloaded) {
        // PostgreSQL cannot resolve a bare function name when overloads exist.
        expect(emitted.sql).toContain('DROP FUNCTION "public"."lookup"(integer)')
      } else {
        expect(emitted.sql).toMatch(/DROP FUNCTION "public"\."lookup"(?:\(integer\))?;/u)
      }

      expect(emitted.sql).not.toContain('DROP FUNCTION "public"."lookup"(text)')
    },
  )
}
