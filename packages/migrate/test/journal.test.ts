import { expect, test } from "vitest"

import {
  canTransitionAttempt,
  migrationJournalFormat,
  migrationJournalVersion,
  validateJournalState,
  type JournalMetadata,
  type MigrationAttempt,
} from "../src/journal/index.ts"
import { InMemoryMigrationJournal } from "../src/journal/memory.ts"
import { fakeDigest } from "../src/testing/index.ts"

const time = "2026-01-01T00:00:00.000Z"

function attempt(state: MigrationAttempt["state"]): MigrationAttempt {
  return {
    id: "attempt-1",
    artifactId: "one",
    artifactDigest: fakeDigest("a"),
    expectedHead: null,
    state,
    startedAt: time,
    updatedAt: time,
  }
}

test("permits only explicit attempt state transitions", () => {
  expect(canTransitionAttempt("started", "running")).toBe(true)
  expect(canTransitionAttempt("running", "applied")).toBe(true)
  expect(canTransitionAttempt("recovery_required", "rolled_back")).toBe(true)
  expect(canTransitionAttempt("applied", "running")).toBe(false)
  expect(canTransitionAttempt("rolled_back", "applied")).toBe(false)
})

test("rejects mutation of immutable history and competing head updates", async () => {
  const journal = new InMemoryMigrationJournal()
  await journal.createAttempt(attempt("started"))
  const record = {
    artifactId: "one",
    sequence: 0,
    artifactDigest: fakeDigest("a"),
    parentArtifactDigest: null,
    kind: "migration" as const,
    attemptId: "attempt-1",
    appliedAt: time,
  }
  await journal.appendApplied(record)
  await expect(journal.appendApplied(record)).rejects.toThrow("immutable")
  await expect(journal.compareAndSwapHead(null, fakeDigest("a"))).resolves.toBe(true)
  await expect(journal.compareAndSwapHead(null, fakeDigest("b"))).resolves.toBe(false)
})

test("detects corrupt history and abandoned attempts", () => {
  const metadata: JournalMetadata = {
    format: migrationJournalFormat,
    version: migrationJournalVersion,
    head: fakeDigest("b"),
  }
  const diagnostics = validateJournalState(
    metadata,
    [
      {
        artifactId: "one",
        sequence: 1,
        artifactDigest: fakeDigest("a"),
        parentArtifactDigest: fakeDigest("c"),
        kind: "migration",
        attemptId: "attempt-1",
        appliedAt: time,
      },
    ],
    [attempt("running")],
  )
  expect(diagnostics.map((item) => item.code)).toEqual(
    expect.arrayContaining(["journal-corrupt", "journal-head-mismatch", "recovery-required"]),
  )
})
