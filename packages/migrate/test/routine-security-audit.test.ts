import { schema } from "qubu"
import { diffSnapshots } from "qubu/diff"
import { createSchemaSnapshot, type SchemaSnapshot } from "qubu/snapshot"
import { mysqlSchemaDialect } from "qubu/snapshot/mysql"
import { postgresSchemaDialect } from "qubu/snapshot/postgres"
import { expect, test } from "vitest"

import { emitMigrationPlan } from "../src/ddl/index.ts"
import { createMigrationPlan } from "../src/plan/index.ts"

for (const dialect of [postgresSchemaDialect, mysqlSchemaDialect]) {
  test.each(["definer", "invoker"] as const)(
    `preserves %s privileges when creating a ${dialect.name} routine`,
    (security) => {
      const postgres = dialect.name === "postgresql"
      const before = createSchemaSnapshot(schema({}, { namespace: "public" }), { dialect })
      const after: SchemaSnapshot = {
        ...before,
        routines: [
          {
            kind: "routine",
            id: "audit_identity",
            physicalName: "audit_identity",
            routineKind: postgres ? "function" : "procedure",
            parameters: [],
            ...(postgres
              ? {
                  returnType: {
                    kind: "native" as const,
                    dialect: "postgresql",
                    type: "text",
                  },
                }
              : {}),
            language: "sql",
            security,
            body: {
              kind: "expression",
              expressionKind: "raw",
              sql: postgres ? "SELECT CURRENT_USER::text" : "SELECT CURRENT_USER()",
            },
          },
        ],
      }
      const planned = createMigrationPlan(diffSnapshots(before, after), {
        allowReviewRequired: true,
      })

      expect(planned.ok, JSON.stringify(planned.diagnostics)).toBe(true)
      const emitted = emitMigrationPlan(planned.plan, dialect, { afterSnapshot: after })

      expect(emitted.ok, JSON.stringify(emitted.diagnostics)).toBe(true)
      expect(emitted.statements).toHaveLength(1)
      // PostgreSQL defaults to INVOKER; MySQL defaults to DEFINER.
      // https://dev.mysql.com/doc/refman/8.4/en/create-procedure.html
      if (postgres ? security === "definer" : security === "invoker") {
        expect(emitted.sql).toMatch(
          postgres ? /\bSECURITY\s+DEFINER\b/iu : /\bSQL\s+SECURITY\s+INVOKER\b/iu,
        )
      } else {
        expect(emitted.sql).not.toMatch(
          postgres ? /\bSECURITY\s+DEFINER\b/iu : /\bSQL\s+SECURITY\s+INVOKER\b/iu,
        )
      }
    },
  )
}
