import { expect, test } from "vitest"

import { reconcileAttempt } from "../src/executor/index.ts"
import { InMemoryMigrationJournal, fakeDigest } from "../src/testing/index.ts"

test("completes reconciliation after a transient failure updating the terminal attempt state", async () => {
  const journal = new InMemoryMigrationJournal()
  const now = "2026-10-22T00:00:00.000Z"

  await journal.createAttempt({
    id: "recovery-attempt",
    artifactId: "create-accounts",
    artifactDigest: fakeDigest("a"),
    expectedHead: null,
    state: "started",
    startedAt: now,
    updatedAt: now,
  })
  await journal.transitionAttempt("recovery-attempt", "recovery_required")

  const transitionAttempt = journal.transitionAttempt.bind(journal)
  const writeFailure = new Error("Transient attempt update failure")
  let failOnce = true

  journal.transitionAttempt = async (id, state, error) => {
    if (state === "rolled_back" && failOnce) {
      failOnce = false
      throw writeFailure
    }

    return transitionAttempt(id, state, error)
  }

  let verifications = 0
  const input = {
    journal,
    attemptId: "recovery-attempt",
    outcome: "rolled_back" as const,
    reason: "Verified the complete pre-state",
    verify: async () => {
      verifications++
      return true
    },
    now: () => now,
  }

  await expect(reconcileAttempt(input)).rejects.toBe(writeFailure)
  expect((await journal.listAttempts())[0]?.state).toBe("recovery_required")
  expect(await journal.listReconciliations()).toHaveLength(1)

  // The database has been verified again and the failed write is now healthy.
  // A previously persisted audit record must not permanently block recovery.
  await expect(reconcileAttempt(input)).resolves.toBeUndefined()
  expect(verifications).toBe(2)
  expect((await journal.listAttempts())[0]?.state).toBe("rolled_back")
  expect(await journal.listReconciliations()).toHaveLength(1)
})
