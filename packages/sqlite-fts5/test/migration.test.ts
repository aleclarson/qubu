import { createMigrationPlan } from "@qubu/migrate/plan"
import { integer, schema, table, text } from "qubu"
import { diffSnapshots } from "qubu/diff"
import { describe, expect, test } from "vitest"

import { fts5 } from "../src/index.ts"
import { fts5Migration } from "../src/migration.ts"

describe("fts5 migration integration", () => {
  test("turns an addon opaque object into an approved custom program", () => {
    const documents = table("documents", {
      id: integer(),
      title: text(),
      body: text(),
    })
    const search = fts5.table({
      name: "documents_fts",
      content: documents,
      contentRowid: documents.id,
      columns: {
        title: documents.title,
        body: documents.body,
      },
    })
    const before = fts5.snapshot.create(schema({ documents }), [])
    const after = fts5.snapshot.create(schema({ documents }), [search])
    const diff = diffSnapshots(before, after)
    const blocked = createMigrationPlan(diff)

    expect(blocked.ok).toBe(false)
    const decisions = blocked.plan.operations
      .filter((operation) => operation.status === "decision-required")
      .map((operation) => ({
        operationId: operation.id,
        action: "allow" as const,
        reason: "FTS5 DDL reviewed by the migration owner",
      }))
    const planned = createMigrationPlan(diff, { decisions })

    expect(planned.ok).toBe(true)
    if (!planned.ok) {
      return
    }

    const inputs = fts5Migration.programs(planned.plan)

    expect(inputs.customPrograms).toHaveLength(1)
    expect(inputs.customPrograms[0]?.statements.map((statement) => statement.sql)).toEqual(
      search.fts5.installSql,
    )

    const compiled = fts5Migration.compile(planned.plan)

    expect(compiled.ok).toBe(true)
    if (!compiled.ok) {
      return
    }

    expect(compiled.program.phases[0]?.statements).toHaveLength(search.fts5.installSql.length)
  })
})
