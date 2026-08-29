import type { MigrationArtifact } from "../artifact/index.ts"
import { compareManagedSnapshots, type ManagedSnapshotComparison } from "../baseline/index.ts"
import type { MigrationAdapter } from "../executor/index.ts"
import { validateJournalState, type MigrationAttempt } from "../journal/index.ts"
import { verifyArtifactChain } from "../repository/index.ts"

export interface MigrationStatus {
  readonly managedDrift?: ManagedSnapshotComparison
  readonly unmanagedObjects: readonly { readonly kind: string; readonly physicalName: string }[]
  readonly pending: readonly MigrationArtifact[]
  readonly interruptedAttempts: readonly MigrationAttempt[]
  readonly incompatibleRequirements: readonly string[]
  readonly diagnostics: readonly { readonly code: string; readonly message: string }[]
}

export async function readMigrationStatus(input: {
  readonly repository:
    | readonly (string | unknown)[]
    | { list(): Promise<readonly (string | unknown)[]> }
  readonly adapter: MigrationAdapter
  readonly signal?: AbortSignal
}): Promise<MigrationStatus> {
  const chain = await verifyArtifactChain(input.repository)
  if (!chain.ok)
    return {
      unmanagedObjects: [],
      pending: [],
      interruptedAttempts: [],
      incompatibleRequirements: [],
      diagnostics: chain.diagnostics,
    }
  const session = await input.adapter.openMigrationSession(input.signal)
  let leased = false
  try {
    await session.acquireLease(input.signal)
    leased = true
    const [metadata, applied, attempts] = await Promise.all([
      session.journal.readMetadata(),
      session.journal.listApplied(),
      session.journal.listAttempts(),
    ])
    const journalDiagnostics = [...validateJournalState(metadata, applied, attempts)]
    for (let index = 0; index < applied.length; index++) {
      const recorded = applied[index]!
      const artifact = chain.artifacts[index]
      if (
        !artifact ||
        artifact.id !== recorded.artifactId ||
        artifact.artifactDigest !== recorded.artifactDigest
      ) {
        journalDiagnostics.push({
          code: "journal-not-prefix",
          path: ["applied", index],
          message: "Recorded history is not an exact repository prefix",
        })
      }
    }
    const pending = chain.artifacts.slice(applied.length)
    const expectedArtifact = chain.artifacts[applied.length - 1]
    const expected = expectedArtifact
      ? expectedArtifact.format === "qubu-verified-baseline"
        ? expectedArtifact.snapshot.value
        : expectedArtifact.afterSnapshot.value
      : pending[0]?.format === "qubu-executable-migration"
        ? pending[0].beforeSnapshot.value
        : undefined
    const snapshot =
      expected?.format === "qubu-schema" && expected.version === 1 ? expected : undefined
    const inspection =
      snapshot && session.readSnapshot ? await session.readSnapshot(snapshot) : undefined
    const incompatibleRequirements = pending.flatMap((artifact) =>
      incompatible(artifact, session.capabilities),
    )
    return Object.freeze({
      ...(inspection && snapshot
        ? { managedDrift: compareManagedSnapshots(snapshot, inspection.snapshot) }
        : {}),
      unmanagedObjects: inspection?.unmanagedObjects ?? [],
      pending,
      interruptedAttempts: attempts.filter(
        (attempt) =>
          attempt.state === "started" ||
          attempt.state === "running" ||
          attempt.state === "recovery_required",
      ),
      incompatibleRequirements,
      diagnostics: journalDiagnostics,
    })
  } finally {
    if (leased) await session.releaseLease()
    await session.close()
  }
}

function incompatible(
  artifact: MigrationArtifact,
  capabilities: {
    readonly dialect: string
    readonly serverVersion?: string
    readonly features?: readonly string[]
    readonly transactions?: readonly string[]
    readonly locks: readonly string[]
  },
): string[] {
  const result: string[] = []
  if (artifact.dialect.name !== capabilities.dialect)
    result.push(`${artifact.id}: dialect ${artifact.dialect.name} is not ${capabilities.dialect}`)
  const available = new Set(capabilities.features ?? [])
  for (const required of artifact.constraints?.requiredCapabilities ?? [])
    if (!available.has(required)) result.push(`${artifact.id}: missing capability ${required}`)
  if (
    artifact.constraints?.minimumServerVersion &&
    (!capabilities.serverVersion ||
      compareVersions(capabilities.serverVersion, artifact.constraints.minimumServerVersion) < 0)
  ) {
    result.push(
      `${artifact.id}: requires server ${artifact.constraints.minimumServerVersion} or newer`,
    )
  }
  if (artifact.format === "qubu-executable-migration") {
    for (const phase of artifact.program.phases) {
      if (!(capabilities.transactions ?? []).includes(phase.transaction))
        result.push(`${artifact.id}: unsupported transaction requirement ${phase.transaction}`)
      if (!capabilities.locks.includes(phase.lock))
        result.push(`${artifact.id}: unsupported lock requirement ${phase.lock}`)
    }
  }
  return result
}

function compareVersions(left: string, right: string): number {
  const a = left.split(/[.-]/u).map((part) => Number.parseInt(part, 10) || 0)
  const b = right.split(/[.-]/u).map((part) => Number.parseInt(part, 10) || 0)
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}
