import type { VerifiedBaselineArtifact } from "../artifact/index.ts"
import { MigrationExecutionError, safeFailure } from "../executor/errors.ts"
import type { MigrationAdapter, MigrationSession } from "../executor/types.ts"
import { validateJournalState } from "../journal/index.ts"
import type { BaselineAdapter } from "./adapter.ts"

/** Use an existing migration adapter's strict reader, lease, and journal for adoption. */
export function fromMigrationAdapter(adapter: MigrationAdapter): BaselineAdapter {
  return {
    async openBaselineSession(scope, signal) {
      const session = await adapter.openMigrationSession(signal)
      let leased = false
      let closed = false
      const close = async () => {
        if (closed) {
          return
        }

        closed = true
        try {
          if (leased) {
            await session.releaseLease()
          }
        } finally {
          await session.close()
        }
      }

      try {
        if (session.capabilities.dialect !== scope.dialect.name || !session.readSnapshot) {
          throw new MigrationExecutionError(
            "capability",
            "Adapter requires compatible strict snapshot inspection for adoption",
            {},
            { retry: "safe" },
          )
        }

        await session.acquireLease(signal)
        leased = true
        return {
          dialect: session.capabilities.dialect,
          readSnapshot: (expected) => session.readSnapshot!(expected),
          async assertEmptyHistory() {
            const [metadata, applied, attempts] = await Promise.all([
              session.journal.readMetadata(),
              session.journal.listApplied(),
              session.journal.listAttempts(),
            ])

            if (
              validateJournalState(metadata, applied, attempts).length ||
              applied.length ||
              attempts.length ||
              metadata.head
            ) {
              throw new MigrationExecutionError(
                "policy",
                "A baseline requires an empty migration journal",
                {},
                { retry: "safe" },
              )
            }
          },
          recordBaseline: (artifact, attemptId) => recordBaseline(session, artifact, attemptId),
          close,
        }
      } catch (error) {
        await close().catch(() => undefined)
        throw error
      }
    },
  }
}

async function recordBaseline(
  session: MigrationSession,
  artifact: VerifiedBaselineArtifact,
  attemptId: string,
): Promise<void> {
  const verifiedAt = artifact.verifiedAt

  await session.journal.createAttempt({
    id: attemptId,
    artifactId: artifact.id,
    artifactDigest: artifact.artifactDigest,
    expectedHead: null,
    state: "started",
    startedAt: verifiedAt,
    updatedAt: verifiedAt,
  })
  await session.beginTransaction()
  let uncertain = false

  try {
    await session.journal.transitionAttempt(attemptId, "running")
    const advanced = await session.journal.appendAppliedAndAdvanceHead(
      {
        artifactId: artifact.id,
        sequence: 0,
        artifactDigest: artifact.artifactDigest,
        parentArtifactDigest: null,
        kind: "baseline",
        attemptId,
        appliedAt: verifiedAt,
      },
      null,
    )

    if (!advanced) {
      throw new Error("Migration journal head changed during baseline creation")
    }

    await session.journal.transitionAttempt(attemptId, "applied")
    try {
      await session.commitTransaction()
    } catch (error) {
      uncertain = session.classifyFailure(error, "commit-transaction") === "uncertain"
      throw error
    }
  } catch (error) {
    try {
      await session.rollbackTransaction()
    } catch {
      uncertain = true
    }

    // Rollback cannot disprove an earlier commit whose acknowledgement was lost.
    await session.journal
      .transitionAttempt(
        attemptId,
        uncertain ? "recovery_required" : "rolled_back",
        safeFailure(error, {}),
      )
      .catch(() => undefined)
    if (uncertain) {
      throw new MigrationExecutionError(
        "uncertain-outcome",
        "Baseline recording requires inspection before retrying",
        {},
        { cause: error },
      )
    }

    throw error
  }
}
