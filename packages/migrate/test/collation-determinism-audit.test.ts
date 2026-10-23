import { schema } from "qubu"
import { diffSnapshots } from "qubu/diff"
import { createSchemaSnapshot, type SchemaSnapshot } from "qubu/snapshot"
import { postgresSchemaDialect } from "qubu/snapshot/postgres"
import { expect, test } from "vitest"

import { emitMigrationPlan } from "../src/ddl/postgres.ts"
import { createMigrationPlan } from "../src/plan/index.ts"

test.each([false, true, undefined])(
  "preserves PostgreSQL collation determinism (%s)",
  (deterministic) => {
    const before = createSchemaSnapshot(schema({}, { namespace: "public" }), {
      dialect: postgresSchemaDialect,
    })
    const after: SchemaSnapshot = {
      ...before,
      collations: [
        {
          kind: "collation",
          id: "case_insensitive",
          physicalName: "case_insensitive",
          provider: "icu",
          locale: "und-u-ks-level2",
          ...(deterministic === undefined ? {} : { deterministic }),
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
    expect(emitted.sql).toContain('CREATE COLLATION "public"."case_insensitive"')
    expect(emitted.sql).toContain("LOCALE = 'und-u-ks-level2'")
    expect(emitted.sql).toContain("PROVIDER = 'icu'")
    if (deterministic === false) {
      // Without this option, a unique column accepts both Alice and alice.
      expect(emitted.sql).toMatch(/DETERMINISTIC\s*=\s*false/iu)
    } else {
      // PostgreSQL defaults to deterministic comparisons when omitted.
      expect(emitted.sql).not.toMatch(/DETERMINISTIC\s*=\s*false/iu)
    }
  },
)
