import { expect, test } from "vitest"

import { readMigrationStatus } from "../src/status/index.ts"
import { DeterministicFakeMigrationAdapter, fakeDigest } from "../src/testing/index.ts"

test("closes the migration status session when releasing its lease fails", async () => {
  const fake = new DeterministicFakeMigrationAdapter({ snapshotDigest: fakeDigest("a") })
  const releaseFailure = new Error("Lease release failed")
  const adapter = {
    async openMigrationSession() {
      const session = await fake.openMigrationSession()

      return {
        ...session,
        async releaseLease() {
          await session.releaseLease()
          throw releaseFailure
        },
      }
    },
  }

  await expect(
    readMigrationStatus({
      repository: [],
      adapter,
    }),
  ).rejects.toBe(releaseFailure)
  expect(fake.events).toContain("close-session")
})

test("releases the lease and closes the migration status session after a journal read fails", async () => {
  const fake = new DeterministicFakeMigrationAdapter({ snapshotDigest: fakeDigest("a") })
  const readFailure = new Error("Journal read failed")
  const adapter = {
    async openMigrationSession() {
      const session = await fake.openMigrationSession()

      session.journal.readMetadata = async () => {
        throw readFailure
      }

      return session
    },
  }

  await expect(
    readMigrationStatus({
      repository: [],
      adapter,
    }),
  ).rejects.toBe(readFailure)
  expect(fake.events.slice(-2)).toEqual(["release-lease", "close-session"])
})
