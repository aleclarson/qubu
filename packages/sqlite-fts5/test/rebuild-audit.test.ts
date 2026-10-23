import { compileMigrationProgram } from "@qubu/migrate/artifact/sqlite"
import { createMigrationPlan } from "@qubu/migrate/plan"
import { integer, schema, table, text } from "qubu"
import { diffSnapshots } from "qubu/diff"
import { expect, test } from "vitest"

import { fts5 } from "../src/index.ts"

function snapshot(nullable: boolean, withSearch: boolean) {
  const documents = table("documents", {
    id: integer(),
    title: text({ nullable }),
  })
  const search = fts5.table({
    name: "documents_fts",
    content: documents,
    contentRowid: documents.id,
    columns: { title: documents.title },
  })

  return fts5.snapshot.create(
    schema({ documents }, { namespace: "main" }),
    withSearch ? [search] : [],
  )
}

test.each([false, true])(
  "requires explicit trigger preservation for a content-table rebuild (FTS: %s)",
  (withSearch) => {
    const before = snapshot(true, withSearch)
    const after = snapshot(false, withSearch)
    const diff = diffSnapshots(before, after)
    const initial = createMigrationPlan(diff)
    const planned = createMigrationPlan(diff, {
      decisions: initial.plan.operations.map((operation) => ({
        operationId: operation.id,
        action: "allow" as const,
        reason: "Review the title nullability change",
      })),
    })

    expect(planned.ok, JSON.stringify(planned.diagnostics)).toBe(true)
    const { plan } = planned
    const compiled = compileMigrationProgram(plan, {
      beforeSnapshot: before,
      afterSnapshot: after,
      approvals: plan.operations.map((operation) => ({
        operationId: operation.id,
        decision: "approve" as const,
        safety: operation.safety,
        findings: plan.diagnostics
          .filter((diagnostic) => diagnostic.operationId === operation.id)
          .map((diagnostic) => diagnostic.code)
          .sort(),
        reason: "Approve the nullability change, without discarding synchronization",
      })),
    })

    if (withSearch) {
      // The addon stores its triggers in an opaque object. Dropping the content
      // table destroys those triggers and silently stops indexing future writes.
      expect(compiled).toMatchObject({
        ok: false,
        diagnostics: expect.arrayContaining([expect.objectContaining({ code: "unsupported" })]),
      })
    } else {
      expect(compiled.ok, JSON.stringify(compiled)).toBe(true)
    }
  },
)
