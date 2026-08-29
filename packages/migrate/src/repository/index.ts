import {
  decodeMigrationArtifact,
  type ArtifactDiagnostic,
  type MigrationArtifact,
  type Sha256Digest,
} from "../artifact/index.ts"
import {
  validateJournalState,
  type AppliedArtifactRecord,
  type JournalDiagnostic,
  type MigrationJournal,
} from "../journal/index.ts"

/** Storage-neutral input boundary. Filesystem discovery belongs to the CLI package. */
export interface ArtifactRepository {
  list(): Promise<readonly (string | unknown)[]>
}

export type ArtifactChainResult =
  | {
      readonly ok: true
      readonly artifacts: readonly MigrationArtifact[]
      readonly head: Sha256Digest | null
    }
  | {
      readonly ok: false
      readonly diagnostics: readonly ArtifactDiagnostic[]
    }

export type RepositoryStateResult =
  | {
      readonly ok: true
      readonly artifacts: readonly MigrationArtifact[]
      readonly applied: readonly AppliedArtifactRecord[]
      readonly pending: readonly MigrationArtifact[]
      readonly head: Sha256Digest | null
    }
  | {
      readonly ok: false
      readonly diagnostics: readonly (ArtifactDiagnostic | JournalDiagnostic)[]
    }

/** Verify both durable history and its exact prefix relationship to a decoded repository. */
export async function verifyRepositoryState(
  source: ArtifactRepository | readonly (string | unknown)[],
  journal: MigrationJournal,
): Promise<RepositoryStateResult> {
  const chain = await verifyArtifactChain(source)
  if (!chain.ok) return chain
  const [metadata, applied, attempts] = await Promise.all([
    journal.readMetadata(),
    journal.listApplied(),
    journal.listAttempts(),
  ])
  const diagnostics: (ArtifactDiagnostic | JournalDiagnostic)[] = [
    ...validateJournalState(metadata, applied, attempts),
  ]
  for (let index = 0; index < applied.length; index++) {
    const recorded = applied[index]!
    const artifact = chain.artifacts[index]
    if (
      !artifact ||
      artifact.id !== recorded.artifactId ||
      artifact.sequence !== recorded.sequence ||
      artifact.artifactDigest !== recorded.artifactDigest
    ) {
      diagnostics.push(
        Object.freeze({
          code: "journal-not-prefix",
          path: Object.freeze(["applied", index]),
          message: "Recorded history is not an exact repository prefix",
        }),
      )
    }
  }
  if (diagnostics.length) return { ok: false, diagnostics: Object.freeze(diagnostics) }
  return Object.freeze({
    ok: true,
    artifacts: chain.artifacts,
    applied,
    pending: Object.freeze(chain.artifacts.slice(applied.length)),
    head: metadata.head,
  })
}

/** Strictly decode and verify an entire linear repository before any artifact is consumed. */
export async function verifyArtifactChain(
  source: ArtifactRepository | readonly (string | unknown)[],
): Promise<ArtifactChainResult> {
  const entries = isRepository(source) ? await source.list() : source
  const artifacts: MigrationArtifact[] = []
  const diagnostics: ArtifactDiagnostic[] = []

  for (let index = 0; index < entries.length; index++) {
    const result = await decodeMigrationArtifact(entries[index])

    if (result.ok) {
      artifacts.push(result.value)
    } else {
      for (const diagnostic of result.diagnostics) {
        diagnostics.push(prefix(index, diagnostic))
      }
    }
  }

  if (diagnostics.length > 0) {
    return {
      ok: false,
      diagnostics: Object.freeze(diagnostics),
    }
  }

  const ids = new Map<string, number>()
  const sequences = new Map<number, number>()
  const parents = new Map<string, number>()

  for (let index = 0; index < artifacts.length; index++) {
    const artifact = artifacts[index]!

    duplicate(ids, artifact.id, index, "id", diagnostics)
    duplicate(sequences, artifact.sequence, index, "sequence", diagnostics)
    if (artifact.parentArtifactDigest !== null) {
      duplicate(
        parents,
        artifact.parentArtifactDigest,
        index,
        "parentArtifactDigest",
        diagnostics,
        "fork",
      )
    }

    if (artifact.sequence !== index) {
      diagnostics.push(
        diag(
          "sequence-gap",
          [index, "sequence"],
          `Expected sequence ${index}, received ${artifact.sequence}`,
        ),
      )
    }

    const expectedParent = index === 0 ? null : artifacts[index - 1]!.artifactDigest

    if (artifact.parentArtifactDigest !== expectedParent) {
      diagnostics.push(
        diag(
          "parent-mismatch",
          [index, "parentArtifactDigest"],
          `Expected parent ${expectedParent ?? "null"}`,
        ),
      )
    }

    if (index > 0 && artifact.dialect.name !== artifacts[0]!.dialect.name) {
      diagnostics.push(
        diag(
          "invalid-value",
          [index, "dialect"],
          "Every artifact in a chain must use the same dialect",
        ),
      )
    }

    if (index > 0 && artifact.format === "qubu-executable-migration") {
      const previous = artifacts[index - 1]!
      const previousSnapshot =
        previous.format === "qubu-executable-migration"
          ? previous.afterSnapshot.digest
          : previous.snapshot.digest
      if (artifact.beforeSnapshot.digest !== previousSnapshot) {
        diagnostics.push(
          diag(
            "snapshot-mismatch",
            [index, "beforeSnapshot", "digest"],
            "Migration before snapshot does not match its parent's resulting snapshot",
          ),
        )
      }
    }
  }

  return diagnostics.length > 0
    ? {
        ok: false,
        diagnostics: Object.freeze(diagnostics),
      }
    : {
        ok: true,
        artifacts: Object.freeze(artifacts),
        head: artifacts.at(-1)?.artifactDigest ?? null,
      }
}

function isRepository(value: ArtifactRepository | readonly unknown[]): value is ArtifactRepository {
  return !Array.isArray(value)
}

function duplicate(
  seen: Map<any, number>,
  value: any,
  index: number,
  field: string,
  out: ArtifactDiagnostic[],
  code: ArtifactDiagnostic["code"] = "duplicate",
): void {
  const previous = seen.get(value)

  if (previous !== undefined) {
    out.push(diag(code, [index, field], `${field} duplicates artifact at index ${previous}`))
  } else {
    seen.set(value, index)
  }
}

function prefix(index: number, value: ArtifactDiagnostic): ArtifactDiagnostic {
  return diag(value.code, [index, ...value.path], value.message)
}

function diag(
  code: ArtifactDiagnostic["code"],
  path: readonly (string | number)[],
  message: string,
): ArtifactDiagnostic {
  return Object.freeze({
    code,
    path: Object.freeze([...path]),
    message,
  })
}
