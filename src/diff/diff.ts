import { canonicalJson, toSnapshotJsonValue } from "../snapshot/canonical.ts"
import {
  completeSchemaSnapshotFingerprint,
  decodeCompleteSchemaSnapshot,
} from "../snapshot/complete.ts"
import type { SchemaSnapshot, SnapshotDiagnostic, SnapshotJsonValue } from "../snapshot/types.ts"
import type {
  SnapshotDiff,
  SnapshotDiffDecodeResult,
  SnapshotDiffDiagnostic,
  SnapshotDiffEvidence,
  SnapshotDiffInput,
  SnapshotDiffObject,
  SnapshotDiffObjectKind,
  SnapshotDiffObjectReference,
  SnapshotDiffOperation,
  SnapshotDiffOptions,
  SnapshotDiffPath,
  SnapshotDiffPropertyChange,
  SnapshotRenameHint,
  SnapshotRenameHintResult,
  SnapshotRenameSuggestion,
  SnapshotRenameTarget,
} from "./types.ts"

type JsonRecord = Record<string, unknown>
type SnapshotRecord = { readonly [key: string]: SnapshotJsonValue }

interface InternalObject {
  readonly object: SnapshotDiffObject
  readonly key: string
  readonly scopeKey: string
  readonly signature: string
  readonly lossy: boolean
  readonly unsupported: boolean
}

interface DecodedSnapshot {
  readonly version: 1
  readonly value: SchemaSnapshot
  readonly records: readonly InternalObject[]
  readonly fingerprint: string
}

interface Match {
  readonly before: InternalObject
  readonly after: InternalObject
  readonly source: "stable-id" | "explicit-hint"
  readonly evidence: readonly SnapshotDiffEvidence[]
}

const objectKinds = new Set<SnapshotDiffObjectKind>([
  "namespace",
  "table",
  "column",
  "constraint",
  "index",
  "view",
  "materialized-view",
  "sequence",
  "enum",
  "domain",
  "collation",
  "trigger",
  "routine",
  "partition",
  "policy",
  "extension",
  "comment",
  "ownership",
  "deferred-object",
  "opaque-object",
])

const operationOrder = new Map([
  ["remove", 0],
  ["physical-rename", 1],
  ["property-change", 2],
  ["add", 3],
])

/**
 * Compare Snapshot v1 values and return immutable, reviewable data.
 *
 * The function never opens a connection, renders SQL, or turns a heuristic match into a rename.
 * Invalid input and malformed hints are represented by diagnostics in the returned value.
 */
export function diffSnapshots(
  beforeInput: SnapshotDiffInput,
  afterInput: SnapshotDiffInput,
  options: SnapshotDiffOptions = {},
): SnapshotDiff {
  const diagnostics: SnapshotDiffDiagnostic[] = []
  const before = decodeSnapshot(beforeInput)
  const after = decodeSnapshot(afterInput)

  diagnostics.push(...before.diagnostics, ...after.diagnostics)

  const hints = options.renameHints ?? options.renames ?? []
  const hintResult = validateSnapshotRenameHints(hints)

  diagnostics.push(...hintResult.diagnostics)
  const validHints = hintResult.value

  if (!before.snapshot || !after.snapshot) {
    return freezeDiff({
      equal: false,
      operations: [],
      changes: [],
      additions: [],
      removals: [],
      propertyChanges: [],
      renames: [],
      added: [],
      removed: [],
      changed: [],
      physicalRenames: [],
      suggestions: [],
      diagnostics: sortDiagnostics(diagnostics),
      issues: sortDiagnostics(diagnostics),
      renameHints: validHints,
      hints: validHints,
      ...(before.snapshot
        ? {
            beforeVersion: before.snapshot.version,
            beforeDialect: before.snapshot.value.dialect,
            beforeFingerprint: before.snapshot.fingerprint,
          }
        : {}),
      ...(after.snapshot
        ? {
            afterVersion: after.snapshot.version,
            afterDialect: after.snapshot.value.dialect,
            afterFingerprint: after.snapshot.fingerprint,
          }
        : {}),
    })
  }

  const left = before.snapshot
  const right = after.snapshot

  if (left.value.dialect.name !== right.value.dialect.name) {
    diagnostics.push(
      diffDiagnostic(
        "dialect-mismatch",
        `Snapshots use different dialects: "${left.value.dialect.name}" and "${right.value.dialect.name}"`,
        [],
        { dialect: right.value.dialect },
      ),
    )
  }

  const beforeByKey = groupByKey(left.records)
  const afterByKey = groupByKey(right.records)

  for (const [key, records] of [...beforeByKey, ...afterByKey]) {
    if (records.length < 2) {
      continue
    }

    diagnostics.push(
      diffDiagnostic(
        "ambiguous",
        `Multiple ${records[0]!.object.kind} records share one logical identity; stable matching is disabled for this key`,
        records[0]!.object.path,
        {
          kind: records[0]!.object.kind,
          namespace: records[0]!.object.namespace,
          logicalId: records[0]!.object.id,
          physicalName: records[0]!.object.physicalName,
          dialect: records[0]!.object.dialect,
          relatedPaths: records.slice(1).map((record) => record.object.path),
          evidence: [
            evidence("ambiguity", undefined, undefined, undefined, `Duplicate stable key ${key}`),
          ],
        },
      ),
    )
  }

  const usedBefore = new Set<InternalObject>()
  const usedAfter = new Set<InternalObject>()
  const matches: Match[] = []
  const parentRenameMappings = new Map<string, string>()
  const recordMatch = (match: Match): void => {
    matches.push(match)
    addParentRenameMapping(match, parentRenameMappings)
  }

  for (const hint of validHints) {
    const beforeCandidates = resolveHintTarget(left.records, hint.kind, hint.namespace, hint.from)
    const afterCandidates = resolveHintTarget(right.records, hint.kind, hint.namespace, hint.to)

    if (beforeCandidates.length !== 1 || afterCandidates.length !== 1) {
      const candidates = [...beforeCandidates, ...afterCandidates]

      diagnostics.push(
        diffDiagnostic(
          beforeCandidates.length === 0 || afterCandidates.length === 0
            ? "invalid-rename-hint"
            : "ambiguous",
          `Rename hint for ${hint.kind} did not resolve to one object on each side`,
          [],
          {
            kind: hint.kind,
            namespace: hint.namespace,
            relatedPaths: candidates.map((candidate) => candidate.object.path),
            evidence: [evidence("explicit-hint", undefined, undefined, 1, "Hint target")],
          },
        ),
      )
      continue
    }

    const beforeObject = beforeCandidates[0]!
    const afterObject = afterCandidates[0]!

    if (usedBefore.has(beforeObject) || usedAfter.has(afterObject)) {
      diagnostics.push(
        diffDiagnostic(
          "rename-conflict",
          `Rename hint for ${hint.kind} reuses an object already mapped by another hint`,
          beforeObject.object.path,
          {
            kind: hint.kind,
            namespace: hint.namespace,
            relatedPaths: [afterObject.object.path],
          },
        ),
      )
      continue
    }

    usedBefore.add(beforeObject)
    usedAfter.add(afterObject)
    recordMatch({
      before: beforeObject,
      after: afterObject,
      source: "explicit-hint",
      evidence: [
        evidence("explicit-hint", undefined, toSnapshotJsonValue(hint), 1, "Explicit rename hint"),
      ],
    })
  }

  for (const [key, beforeCandidates] of beforeByKey) {
    const afterCandidates = afterByKey.get(key) ?? []

    if (beforeCandidates.length !== 1 || afterCandidates.length !== 1) {
      continue
    }

    const beforeObject = beforeCandidates[0]!
    const afterObject = afterCandidates[0]!

    if (usedBefore.has(beforeObject) || usedAfter.has(afterObject)) {
      continue
    }

    usedBefore.add(beforeObject)
    usedAfter.add(afterObject)
    recordMatch({
      before: beforeObject,
      after: afterObject,
      source: "stable-id",
      evidence: [
        evidence(
          "logical-id",
          [...beforeObject.object.path, "id"],
          beforeObject.object.id,
          1,
          "Stable logical ID match",
        ),
      ],
    })
  }

  // Parent matches can unlock child matches by remapping the child's scoped key. Repeat
  // until a pass adds no mappings so nested descendants are settled before suggestions.
  let matchedDescendant = true

  while (matchedDescendant) {
    matchedDescendant = false
    const remainingBefore = left.records.filter(
      (record) => !usedBefore.has(record) && record.object.parent !== undefined,
    )
    const remainingAfter = right.records.filter(
      (record) => !usedAfter.has(record) && record.object.parent !== undefined,
    )
    const beforeByMappedKey = groupByKey(remainingBefore, (record) =>
      remappedObjectKey(record, parentRenameMappings),
    )
    const afterByRemainingKey = groupByKey(remainingAfter)

    for (const [key, beforeCandidates] of beforeByMappedKey) {
      const afterCandidates = afterByRemainingKey.get(key) ?? []

      if (beforeCandidates.length !== 1 || afterCandidates.length !== 1) {
        continue
      }

      const beforeObject = beforeCandidates[0]!
      const afterObject = afterCandidates[0]!

      usedBefore.add(beforeObject)
      usedAfter.add(afterObject)
      recordMatch({
        before: beforeObject,
        after: afterObject,
        source: "stable-id",
        evidence: [
          evidence(
            "logical-id",
            [...beforeObject.object.path, "id"],
            beforeObject.object.id,
            1,
            "Stable logical ID match within a renamed parent scope",
          ),
        ],
      })
      matchedDescendant = true
    }
  }

  const suggestions: SnapshotRenameSuggestion[] = []
  const suggestionThreshold = clampThreshold(options.suggestionThreshold)
  const unmatchedBefore = left.records.filter((record) => !usedBefore.has(record))
  const unmatchedAfter = right.records.filter((record) => !usedAfter.has(record))

  if (options.suggestions !== false) {
    for (const beforeObject of unmatchedBefore) {
      if (beforeObject.lossy || beforeObject.unsupported) {
        continue
      }

      const candidates = unmatchedAfter
        .filter(
          (candidate) =>
            !candidate.lossy &&
            !candidate.unsupported &&
            candidate.scopeKey === scopeKeyForRecord(beforeObject, parentRenameMappings),
        )
        .map((candidate) => ({
          candidate,
          score: structuralScore(beforeObject, candidate),
        }))
        .filter((candidate) => candidate.score >= suggestionThreshold)
        .sort(
          (leftCandidate, rightCandidate) =>
            rightCandidate.score - leftCandidate.score ||
            compareObject(leftCandidate.candidate, rightCandidate.candidate),
        )

      if (candidates.length === 0) {
        continue
      }

      const best = candidates[0]!
      const tied = candidates.filter(
        (candidate) => Math.abs(candidate.score - best.score) < 0.000001,
      )

      if (tied.length > 1) {
        diagnostics.push(
          diffDiagnostic(
            "ambiguous",
            `Multiple structural matches are possible for ${beforeObject.object.kind} "${beforeObject.object.id}"; no rename was inferred`,
            beforeObject.object.path,
            {
              kind: beforeObject.object.kind,
              namespace: beforeObject.object.namespace,
              logicalId: beforeObject.object.id,
              physicalName: beforeObject.object.physicalName,
              dialect: beforeObject.object.dialect,
              relatedPaths: tied.map((item) => item.candidate.object.path),
              evidence: [
                evidence(
                  "ambiguity",
                  undefined,
                  undefined,
                  best.score,
                  `${tied.length} candidates scored ${best.score.toFixed(3)}`,
                ),
              ],
            },
          ),
        )
        continue
      }

      suggestions.push({
        type: "rename-suggestion",
        operation: "rename-suggestion",
        kind: beforeObject.object.kind,
        objectKind: beforeObject.object.kind,
        namespace: beforeObject.object.namespace,
        before: beforeObject.object,
        after: best.candidate.object,
        confidence: best.score,
        evidence: [
          evidence(
            "structural",
            undefined,
            undefined,
            best.score,
            "Stable structure matched after removing identity evidence",
          ),
        ],
      })
    }
  }

  const operations: SnapshotDiffOperation[] = []

  for (const match of matches) {
    const operation = operationForMatch(match, diagnostics)

    if (operation !== undefined) {
      operations.push(operation)
    }
  }

  for (const record of unmatchedBefore) {
    const operation = operationForUnmatched("remove", record.object)

    operations.push(operation)
    diagnostics.push(
      diffDiagnostic(
        "destructive",
        `Removing ${record.object.kind} "${record.object.id}" is destructive`,
        record.object.path,
        {
          kind: record.object.kind,
          namespace: record.object.namespace,
          logicalId: record.object.id,
          physicalName: record.object.physicalName,
          dialect: record.object.dialect,
          evidence: record.object.evidence,
        },
      ),
    )
  }

  for (const record of unmatchedAfter) {
    operations.push(operationForUnmatched("add", record.object))
  }

  for (const record of [...left.records, ...right.records]) {
    if (!record.lossy && !record.unsupported) {
      continue
    }

    diagnostics.push(
      diffDiagnostic(
        record.lossy ? "lossy" : "unsupported",
        record.lossy
          ? `${record.object.kind} "${record.object.id}" contains opaque or deferred facts`
          : `${record.object.kind} "${record.object.id}" is outside the supported comparison surface`,
        record.object.path,
        {
          kind: record.object.kind,
          namespace: record.object.namespace,
          logicalId: record.object.id,
          physicalName: record.object.physicalName,
          dialect: record.object.dialect,
          evidence: record.object.evidence,
        },
      ),
    )
    if (record.lossy && record.unsupported) {
      diagnostics.push(
        diffDiagnostic(
          "unsupported",
          `${record.object.kind} "${record.object.id}" cannot be structurally compared yet`,
          record.object.path,
          {
            kind: record.object.kind,
            namespace: record.object.namespace,
            logicalId: record.object.id,
            physicalName: record.object.physicalName,
            dialect: record.object.dialect,
            evidence: record.object.evidence,
          },
        ),
      )
    }

    if (record.object.kind === "deferred-object") {
      diagnostics.push(
        diffDiagnostic(
          "unknown",
          `${record.object.kind} "${record.object.id}" retains an observed object without a complete model`,
          record.object.path,
          {
            kind: record.object.kind,
            namespace: record.object.namespace,
            logicalId: record.object.id,
            physicalName: record.object.physicalName,
            dialect: record.object.dialect,
            evidence: record.object.evidence,
          },
        ),
      )
    }
  }

  const sortedOperations = operations.sort(compareOperation)
  const frozenSuggestions = suggestions.sort(compareSuggestion)
  const additions = sortedOperations.filter((operation) => operation.type === "add")
  const removals = sortedOperations.filter((operation) => operation.type === "remove")
  const propertyChanges = sortedOperations.filter(
    (operation) => operation.type === "property-change",
  )
  const renames = sortedOperations.filter((operation) => operation.type === "physical-rename")
  const frozenDiagnostics = sortDiagnostics(diagnostics)

  return freezeDiff({
    equal: sortedOperations.length === 0,
    beforeVersion: left.version,
    afterVersion: right.version,
    beforeDialect: left.value.dialect,
    afterDialect: right.value.dialect,
    beforeFingerprint: left.fingerprint,
    afterFingerprint: right.fingerprint,
    operations: sortedOperations,
    changes: sortedOperations,
    additions,
    removals,
    propertyChanges,
    renames,
    added: additions,
    removed: removals,
    changed: sortedOperations,
    physicalRenames: renames,
    suggestions: frozenSuggestions,
    diagnostics: frozenDiagnostics,
    issues: frozenDiagnostics,
    renameHints: validHints,
    hints: validHints,
  })
}

/** Alias that reads naturally in comparison-oriented callers. */
export const compareSnapshots = diffSnapshots

/** Decode and normalize a Snapshot v1 value without throwing. */
export function decodeSnapshotForDiff(input: SnapshotDiffInput): SnapshotDiffDecodeResult {
  const decoded = decodeSnapshot(input)

  if (!decoded.snapshot) {
    return {
      ok: false,
      diagnostics: decoded.diagnostics,
    }
  }

  return {
    ok: true,
    version: decoded.snapshot.version,
    value: decoded.snapshot.value,
  }
}

/** Validate rename hints and return a frozen, serializable list. */
export function validateSnapshotRenameHints(
  hints: readonly SnapshotRenameHint[] | unknown,
): SnapshotRenameHintResult {
  const diagnostics: SnapshotDiffDiagnostic[] = []
  const values: SnapshotRenameHint[] = []

  if (!Array.isArray(hints)) {
    diagnostics.push(
      diffDiagnostic("invalid-rename-hint", "Rename hints must be an array", ["renameHints"]),
    )
    return {
      ok: false,
      value: [],
      diagnostics: freeze(diagnostics),
    }
  }

  const seen = new Set<string>()

  for (const [index, value] of hints.entries()) {
    const path: SnapshotDiffPath = ["renameHints", index]
    const diagnosticCount = diagnostics.length

    if (!isRecord(value)) {
      diagnostics.push(diffDiagnostic("invalid-rename-hint", "Rename hint must be an object", path))
      continue
    }

    for (const key of Object.keys(value)) {
      if (key !== "kind" && key !== "namespace" && key !== "from" && key !== "to") {
        diagnostics.push(
          diffDiagnostic("invalid-rename-hint", `Unknown rename hint field "${key}"`, [
            ...path,
            key,
          ]),
        )
      }
    }

    const kind = value.kind
    const namespace = value.namespace

    if (!isObjectKind(kind)) {
      diagnostics.push(
        diffDiagnostic(
          "invalid-rename-hint",
          "Rename hint kind is not a supported snapshot object kind",
          [...path, "kind"],
        ),
      )
    }

    if (namespace !== undefined && (typeof namespace !== "string" || namespace.length === 0)) {
      diagnostics.push(
        diffDiagnostic(
          "invalid-rename-hint",
          "Rename hint namespace must be a non-empty string when provided",
          [...path, "namespace"],
        ),
      )
    }

    const from = normalizeRenameTarget(value.from, [...path, "from"], diagnostics)
    const to = normalizeRenameTarget(value.to, [...path, "to"], diagnostics)

    if (
      !isObjectKind(kind) ||
      (typeof namespace !== "string" && namespace !== undefined) ||
      namespace === "" ||
      from === undefined ||
      to === undefined ||
      diagnostics.length !== diagnosticCount
    ) {
      continue
    }

    const hint: SnapshotRenameHint = freeze({
      kind,
      ...(typeof namespace === "string" ? { namespace } : {}),
      from: typeof value.from === "string" ? value.from : from,
      to: typeof value.to === "string" ? value.to : to,
    })
    const key = `${kind}\u0000${namespace ?? ""}\u0000${targetKey(from)}\u0000${targetKey(to)}`

    if (seen.has(key)) {
      diagnostics.push(
        diffDiagnostic("rename-conflict", "Duplicate rename hint", path, {
          kind,
          namespace: typeof namespace === "string" ? namespace : undefined,
        }),
      )
      continue
    }

    seen.add(key)
    values.push(hint)
  }

  const frozenValues = freeze(values.sort(compareHint))

  if (diagnostics.length > 0) {
    return {
      ok: false,
      value: frozenValues,
      diagnostics: freeze(sortDiagnostics(diagnostics)),
    }
  }

  return {
    ok: true,
    value: frozenValues,
    diagnostics: freeze([]),
  }
}

/** Serialize validated rename hints as deterministic JSON. */
export function encodeSnapshotRenameHints(hints: readonly SnapshotRenameHint[]): string {
  const result = validateSnapshotRenameHints(hints)

  if (!result.ok) {
    throw new TypeError(result.diagnostics.map((item) => item.message).join("\n"))
  }

  return canonicalJson(toSnapshotJsonValue(result.value))
}

/** Decode deterministic rename-hint JSON without throwing. */
export function decodeSnapshotRenameHints(input: string | unknown): SnapshotRenameHintResult {
  let value: unknown = input

  if (typeof input === "string") {
    try {
      value = JSON.parse(input) as unknown
    } catch (error) {
      return {
        ok: false,
        value: [],
        diagnostics: freeze([
          diffDiagnostic(
            "invalid-rename-hint",
            `Rename hint JSON could not be parsed: ${
              error instanceof Error ? error.message : String(error)
            }`,
            [],
          ),
        ]),
      }
    }
  }

  return validateSnapshotRenameHints(value)
}

/** Short aliases for callers that keep rename helpers beside `diffSnapshots`. */
export const validateRenameHints = validateSnapshotRenameHints
export const encodeRenameHints = encodeSnapshotRenameHints
export const decodeRenameHints = decodeSnapshotRenameHints

function decodeSnapshot(input: SnapshotDiffInput): {
  readonly snapshot?: DecodedSnapshot
  readonly diagnostics: readonly SnapshotDiffDiagnostic[]
} {
  const diagnostics: SnapshotDiffDiagnostic[] = []
  let value: unknown = input

  if (typeof input === "string") {
    try {
      value = JSON.parse(input) as unknown
    } catch (error) {
      diagnostics.push(
        diffDiagnostic(
          "invalid-snapshot",
          `Snapshot JSON could not be parsed: ${
            error instanceof Error ? error.message : String(error)
          }`,
          [],
        ),
      )
      return { diagnostics }
    }
  }

  if (!isRecord(value)) {
    diagnostics.push(diffDiagnostic("invalid-snapshot", "Snapshot must be an object", []))
    return { diagnostics }
  }

  const version = value.version
  const normalized = sortSnapshotArrays(value)

  if (version === 1) {
    const result = decodeCompleteSchemaSnapshot(normalized)

    if (!result.ok) {
      diagnostics.push(...mapSnapshotDiagnostics(result.diagnostics))
      return { diagnostics }
    }

    const snapshot = result.value

    return {
      diagnostics,
      snapshot: {
        version: 1,
        value: snapshot,
        records: extractSnapshotObjects(snapshot),
        fingerprint: completeSchemaSnapshotFingerprint(snapshot),
      },
    }
  }

  diagnostics.push(
    diffDiagnostic("invalid-snapshot", `Unsupported schema snapshot version: ${String(version)}`, [
      "version",
    ]),
  )
  return { diagnostics }
}

function extractSnapshotObjects(snapshot: SchemaSnapshot): readonly InternalObject[] {
  const records: InternalObject[] = []
  const namespace = snapshot.namespace.name

  addInternalObject(
    records,
    "namespace",
    snapshot.namespace,
    ["namespace"],
    namespace,
    undefined,
    snapshot,
  )
  for (const [tableIndex, table] of snapshot.tables.entries()) {
    const tableObject = addInternalObject(
      records,
      "table",
      table,
      ["tables", tableIndex],
      namespace,
      undefined,
      snapshot,
    )

    for (const [columnIndex, column] of table.columns.entries()) {
      addInternalObject(
        records,
        "column",
        column,
        ["tables", tableIndex, "columns", columnIndex],
        namespace,
        tableObject,
        snapshot,
      )
    }

    for (const [constraintIndex, constraint] of table.constraints.entries()) {
      addInternalObject(
        records,
        "constraint",
        constraint,
        ["tables", tableIndex, "constraints", constraintIndex],
        namespace,
        tableObject,
        snapshot,
      )
    }

    for (const [indexIndex, index] of table.indexes.entries()) {
      addInternalObject(
        records,
        "index",
        index,
        ["tables", tableIndex, "indexes", indexIndex],
        namespace,
        tableObject,
        snapshot,
      )
    }
  }

  const groups: readonly [keyof SchemaSnapshot, SnapshotDiffObjectKind][] = [
    ["views", "view"],
    ["sequences", "sequence"],
    ["enums", "enum"],
    ["domains", "domain"],
    ["collations", "collation"],
    ["triggers", "trigger"],
    ["routines", "routine"],
    ["partitions", "partition"],
    ["policies", "policy"],
    ["extensions", "extension"],
    ["deferredObjects", "deferred-object"],
    ["opaqueObjects", "opaque-object"],
    ["comments", "comment"],
    ["ownership", "ownership"],
  ]

  for (const [group, defaultKind] of groups) {
    const values = snapshot[group]

    if (!Array.isArray(values)) {
      continue
    }

    for (const [index, value] of values.entries()) {
      const record = value as unknown as JsonRecord
      const kind =
        defaultKind === "view" && record.kind === "materialized-view"
          ? "materialized-view"
          : defaultKind
      const object = addInternalObject(
        records,
        kind,
        value,
        [String(group), index],
        namespace,
        undefined,
        snapshot,
      )

      if (kind === "view" || kind === "materialized-view") {
        const columns = (value as SchemaSnapshot["views"][number]).columns

        for (const [columnIndex, column] of columns.entries()) {
          addInternalObject(
            records,
            "column",
            column,
            [String(group), index, "columns", columnIndex],
            namespace,
            object,
            snapshot,
          )
        }
      }

      // Parent collection fields are intentionally skipped by generic comparison, so
      // domain constraints must be indexed as child objects to remain diffable.
      if (kind === "domain") {
        const constraints = (value as SchemaSnapshot["domains"][number]).constraints ?? []

        for (const [constraintIndex, constraint] of constraints.entries()) {
          addInternalObject(
            records,
            "constraint",
            constraint,
            [String(group), index, "constraints", constraintIndex],
            namespace,
            object,
            snapshot,
          )
        }
      }
    }
  }

  return freeze(records.sort(compareObject))
}

function addInternalObject(
  records: InternalObject[],
  kind: SnapshotDiffObjectKind,
  value: unknown,
  path: SnapshotDiffPath,
  namespace: string | undefined,
  parent: InternalObject | undefined,
  snapshot: SchemaSnapshot,
): InternalObject {
  const record = value as JsonRecord
  const id =
    typeof record.id === "string"
      ? record.id
      : kind === "namespace" && typeof record.name === "string"
        ? record.name
        : typeof record.physicalName === "string"
          ? record.physicalName
          : `${kind}:${path.join(".")}`
  const physicalName =
    typeof record.physicalName === "string"
      ? record.physicalName
      : kind === "namespace" && typeof record.name === "string"
        ? record.name
        : undefined
  const physicalReference = record.physicalReference
  const provenance = record.provenance
  const observedKind =
    kind === "deferred-object" || kind === "opaque-object"
      ? typeof record.objectKind === "string"
        ? record.objectKind
        : undefined
      : undefined
  const dialect = snapshot.dialect
  const object: SnapshotDiffObject = {
    kind,
    ...(observedKind === undefined ? {} : { observedKind }),
    ...(namespace === undefined ? {} : { namespace }),
    path: freeze([...path]),
    ...(parent === undefined
      ? {}
      : {
          parent: freeze({
            kind: parent.object.kind,
            id: parent.object.id,
            ...(namespace === undefined ? {} : { namespace }),
          } satisfies SnapshotDiffObjectReference),
        }),
    id,
    ...(physicalName === undefined ? {} : { physicalName }),
    ...(physicalReference === undefined
      ? {}
      : { physicalReference: physicalReference as SnapshotJsonValue }),
    dialect,
    ...(provenance === undefined ? {} : { provenance: provenance as SnapshotJsonValue }),
    value: record as Record<string, SnapshotJsonValue>,
    evidence: makeEvidence(record, path, id, physicalName, dialect),
  }
  const internal: InternalObject = {
    object: freeze(object),
    key: objectKey(kind, namespace, parent, id),
    scopeKey: `${kind}\u0000${namespace ?? ""}\u0000${parent?.object.id ?? ""}`,
    signature: structuralSignature(record),
    lossy: kind === "opaque-object" || kind === "deferred-object",
    unsupported: kind === "opaque-object" || kind === "deferred-object",
  }

  records.push(internal)
  return internal
}

function operationForMatch(
  match: Match,
  diagnostics: SnapshotDiffDiagnostic[],
): SnapshotDiffOperation | undefined {
  const before = match.before.object
  const after = match.after.object
  const changedProperties = propertyChangesBetween(before.value, after.value)
  const physicalRename =
    before.physicalName !== undefined &&
    after.physicalName !== undefined &&
    before.physicalName !== after.physicalName
  const blockedRename = match.before.lossy || match.after.lossy
  const effectiveChanges =
    physicalRename && blockedRename && changedProperties.length === 0
      ? freeze([
          {
            path: freeze(["physicalName"]),
            before: before.physicalName,
            after: after.physicalName,
          },
        ])
      : changedProperties

  if (physicalRename && blockedRename) {
    diagnostics.push(
      diffDiagnostic(
        "lossy",
        `Physical-name change for ${before.kind} "${before.id}" is not promoted to a rename because the record is opaque or deferred`,
        before.path,
        {
          kind: before.kind,
          namespace: before.namespace,
          logicalId: before.id,
          physicalName: before.physicalName,
          dialect: after.dialect,
          relatedPaths: [after.path],
          evidence: [...before.evidence, ...after.evidence],
        },
      ),
    )
  }

  const destructive = effectiveChanges.some(isDestructiveProperty)

  if (physicalRename && !blockedRename) {
    if (destructive) {
      diagnostics.push(
        diffDiagnostic(
          "destructive",
          `Property changes on ${before.kind} "${before.id}" may remove or narrow existing data`,
          before.path,
          {
            kind: before.kind,
            namespace: before.namespace,
            logicalId: before.id,
            physicalName: before.physicalName,
            dialect: after.dialect,
            relatedPaths: [after.path],
            evidence: match.evidence,
          },
        ),
      )
    }

    return freeze({
      type: "physical-rename",
      operation: "physical-rename",
      classification: "physical-rename",
      changeKind: "physical-rename",
      kind: before.kind,
      objectKind: before.kind,
      namespace: before.namespace ?? after.namespace,
      path: after.path,
      dialect: after.dialect,
      ...(after.physicalReference === undefined
        ? {}
        : { physicalReference: after.physicalReference }),
      ...(after.provenance === undefined ? {} : { provenance: after.provenance }),
      before,
      after,
      object: after,
      logicalId: after.id,
      physicalName: after.physicalName,
      ...(changedProperties.length === 0 ? {} : { changedProperties }),
      evidence: freeze([
        ...match.evidence,
        evidence(
          "physical-name",
          [...before.path, "physicalName"],
          before.physicalName,
          1,
          "Physical name changed while the logical match remained stable",
        ),
        evidence(
          "physical-name",
          [...after.path, "physicalName"],
          after.physicalName,
          1,
          "New physical name",
        ),
      ]),
      source: match.source,
      destructive,
    })
  }

  if (effectiveChanges.length === 0) {
    return undefined
  }

  if (destructive) {
    diagnostics.push(
      diffDiagnostic(
        "destructive",
        `Property changes on ${before.kind} "${before.id}" may remove or narrow existing data`,
        before.path,
        {
          kind: before.kind,
          namespace: before.namespace,
          logicalId: before.id,
          physicalName: before.physicalName,
          dialect: after.dialect,
          relatedPaths: [after.path],
          evidence: match.evidence,
        },
      ),
    )
  }

  return freeze({
    type: "property-change",
    operation: "property-change",
    classification: "property-change",
    changeKind: "property-change",
    kind: before.kind,
    objectKind: before.kind,
    namespace: before.namespace ?? after.namespace,
    path: after.path,
    dialect: after.dialect,
    ...(after.physicalReference === undefined
      ? {}
      : { physicalReference: after.physicalReference }),
    ...(after.provenance === undefined ? {} : { provenance: after.provenance }),
    before,
    after,
    object: after,
    logicalId: after.id,
    physicalName: after.physicalName,
    changedProperties: effectiveChanges,
    evidence: match.evidence,
    source: match.source,
    destructive,
  })
}

function operationForUnmatched(
  type: "add" | "remove",
  object: SnapshotDiffObject,
): SnapshotDiffOperation {
  return freeze({
    type,
    operation: type,
    classification: type,
    changeKind: type,
    kind: object.kind,
    objectKind: object.kind,
    namespace: object.namespace,
    path: object.path,
    dialect: object.dialect,
    ...(object.physicalReference === undefined
      ? {}
      : { physicalReference: object.physicalReference }),
    ...(object.provenance === undefined ? {} : { provenance: object.provenance }),
    ...(type === "remove" ? { before: object } : { after: object }),
    object,
    logicalId: object.id,
    physicalName: object.physicalName,
    evidence: object.evidence,
    source: "stable-id",
    destructive: type === "remove",
  })
}

function resolveHintTarget(
  records: readonly InternalObject[],
  kind: SnapshotDiffObjectKind,
  namespace: string | undefined,
  target: string | SnapshotRenameTarget,
): readonly InternalObject[] {
  const scalarTarget = typeof target === "string" ? target : undefined
  const normalized = typeof target === "string" ? undefined : target

  return records.filter((record) => {
    if (
      record.object.kind !== kind ||
      (namespace !== undefined && record.object.namespace !== namespace)
    ) {
      return false
    }

    if (
      scalarTarget !== undefined &&
      record.object.id !== scalarTarget &&
      record.object.physicalName !== scalarTarget
    ) {
      return false
    }

    if (normalized === undefined) {
      return true
    }

    if (normalized.path !== undefined && !samePath(record.object.path, normalized.path)) {
      return false
    }

    if (normalized.id !== undefined && record.object.id !== normalized.id) {
      return false
    }

    if (
      normalized.physicalName !== undefined &&
      record.object.physicalName !== normalized.physicalName
    ) {
      return false
    }

    return true
  })
}

function structuralScore(left: InternalObject, right: InternalObject): number {
  if (left.signature === right.signature) {
    return 1
  }

  const leftRecord = stripIdentity(left.object.value as SnapshotJsonValue)
  const rightRecord = stripIdentity(right.object.value as SnapshotJsonValue)

  if (!isSnapshotRecord(leftRecord) || !isSnapshotRecord(rightRecord)) {
    return 0
  }

  const leftKeys = new Set(Object.keys(leftRecord))
  const rightKeys = new Set(Object.keys(rightRecord))
  const keys = new Set([...leftKeys, ...rightKeys])

  if (keys.size === 0) {
    return 0
  }

  let equal = 0

  for (const key of keys) {
    if (
      key in leftRecord &&
      key in rightRecord &&
      canonicalEquivalent(leftRecord[key], rightRecord[key])
    ) {
      equal += 1
    }
  }

  return equal / keys.size
}

function structuralSignature(value: JsonRecord): string {
  return canonicalJson(stripIdentity(value as SnapshotJsonValue))
}

// Only the matched record's own identity is structural noise; nested IDs and physical
// references can describe real relationship changes.
function stripIdentity(value: SnapshotJsonValue, root = true): SnapshotJsonValue {
  if (Array.isArray(value)) {
    return value.map((item) => stripIdentity(item, false)) as readonly SnapshotJsonValue[]
  }

  if (value === null || typeof value !== "object") {
    return value
  }

  const result: Record<string, SnapshotJsonValue> = {}

  for (const [key, child] of Object.entries(value)) {
    if (root && isIdentityField(key)) {
      continue
    }

    result[key] = stripIdentity(child, false)
  }

  return result
}

function propertyChangesBetween(
  before: Readonly<Record<string, SnapshotJsonValue>>,
  after: Readonly<Record<string, SnapshotJsonValue>>,
): readonly SnapshotDiffPropertyChange[] {
  const changes: SnapshotDiffPropertyChange[] = []

  compareValues(before, after, [], changes)
  return freeze(changes)
}

function compareValues(
  before: SnapshotJsonValue | undefined,
  after: SnapshotJsonValue | undefined,
  path: SnapshotDiffPath,
  changes: SnapshotDiffPropertyChange[],
): void {
  const key = path[path.length - 1]

  if (
    path.length === 1 &&
    (key === "id" || key === "physicalName" || key === "physicalReference")
  ) {
    return
  }

  if (path.length === 1 && (key === "columns" || key === "constraints" || key === "indexes")) {
    return
  }

  if (canonicalEquivalent(before, after)) {
    return
  }

  if (isSnapshotRecord(before) && isSnapshotRecord(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)])

    for (const childKey of [...keys].sort()) {
      compareValues(
        before[childKey] as SnapshotJsonValue | undefined,
        after[childKey] as SnapshotJsonValue | undefined,
        [...path, childKey],
        changes,
      )
    }

    return
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    const length = Math.max(before.length, after.length)

    for (let index = 0; index < length; index += 1) {
      compareValues(before[index], after[index], [...path, index], changes)
    }

    return
  }

  changes.push({
    path: freeze([...path]),
    ...(before === undefined ? {} : { before }),
    ...(after === undefined ? {} : { after }),
  })
}

function isIdentityField(key: string | number | undefined): boolean {
  return (
    key === "id" || key === "physicalName" || key === "physicalReference" || key === "provenance"
  )
}

function isDestructiveProperty(change: SnapshotDiffPropertyChange): boolean {
  if (change.after === undefined) {
    return true
  }

  const key = change.path[change.path.length - 1]

  if (key === "nullable") {
    return change.after === false
  }

  if (key === "storage" || key === "default" || key === "generatedColumn") {
    return true
  }

  if (key === "columns" || key === "terms" || key === "constraints") {
    return true
  }

  return false
}

function makeEvidence(
  record: JsonRecord,
  path: SnapshotDiffPath,
  id: string,
  physicalName: string | undefined,
  dialect: SchemaSnapshot["dialect"],
): readonly SnapshotDiffEvidence[] {
  const result: SnapshotDiffEvidence[] = [
    evidence("logical-id", [...path, "id"], id, 1, "Stable logical ID"),
    evidence("dialect", undefined, toSnapshotJsonValue(dialect), 1, "Snapshot dialect"),
  ]

  if (physicalName !== undefined) {
    result.push(
      evidence(
        "physical-name",
        [...path, "physicalName"],
        physicalName,
        1,
        "Physical name evidence",
      ),
    )
  }

  if (record.physicalReference !== undefined) {
    result.push(
      evidence(
        "physical-reference",
        [...path, "physicalReference"],
        record.physicalReference as SnapshotJsonValue,
        1,
        "Physical reference evidence",
      ),
    )
  }

  if (record.provenance !== undefined) {
    result.push(
      evidence(
        "provenance",
        [...path, "provenance"],
        record.provenance as SnapshotJsonValue,
        1,
        "Catalog or decompiler provenance",
      ),
    )
  }

  return freeze(result)
}

function evidence(
  kind: SnapshotDiffEvidence["kind"],
  path?: SnapshotDiffPath,
  value?: SnapshotJsonValue,
  confidence?: number,
  message?: string,
): SnapshotDiffEvidence {
  return freeze({
    kind,
    ...(path === undefined ? {} : { path: freeze([...path]) }),
    ...(value === undefined ? {} : { value }),
    ...(confidence === undefined ? {} : { confidence }),
    ...(message === undefined ? {} : { message }),
  })
}

function diffDiagnostic(
  code: SnapshotDiffDiagnostic["code"],
  message: string,
  path: SnapshotDiffPath,
  options: {
    readonly kind?: SnapshotDiffObjectKind
    readonly namespace?: string
    readonly logicalId?: string
    readonly physicalName?: string
    readonly dialect?: SchemaSnapshot["dialect"]
    readonly relatedPaths?: readonly SnapshotDiffPath[]
    readonly evidence?: readonly SnapshotDiffEvidence[]
  } = {},
): SnapshotDiffDiagnostic {
  return {
    code,
    category: code,
    severity:
      code === "ambiguous" ||
      code === "invalid-snapshot" ||
      code === "invalid-rename-hint" ||
      code === "rename-conflict" ||
      code === "dialect-mismatch"
        ? "error"
        : "warning",
    message,
    path: freeze([...path]),
    ...(options.relatedPaths === undefined
      ? {}
      : {
          relatedPaths: freeze(options.relatedPaths.map((item) => freeze([...item]))),
        }),
    ...(options.kind === undefined
      ? {}
      : {
          kind: options.kind,
          objectKind: options.kind,
        }),
    ...(options.namespace === undefined ? {} : { namespace: options.namespace }),
    ...(options.logicalId === undefined ? {} : { logicalId: options.logicalId }),
    ...(options.physicalName === undefined ? {} : { physicalName: options.physicalName }),
    ...(options.dialect === undefined ? {} : { dialect: options.dialect }),
    ...(options.evidence === undefined ? {} : { evidence: freeze([...options.evidence]) }),
  }
}

function mapSnapshotDiagnostics(
  diagnostics: readonly SnapshotDiagnostic[],
): readonly SnapshotDiffDiagnostic[] {
  return diagnostics.map((item) => {
    const code: SnapshotDiffDiagnostic["code"] =
      item.code === "unknown-field"
        ? "unknown"
        : item.code === "future-version" ||
            item.code === "unsupported-expression" ||
            item.code === "unsupported-dialect-option"
          ? "unsupported"
          : "invalid-snapshot"

    return diffDiagnostic(code, item.message, item.path, {
      relatedPaths: item.relatedPaths,
    })
  })
}

function groupByKey(
  records: readonly InternalObject[],
  keyFor: (record: InternalObject) => string = (record) => record.key,
): ReadonlyMap<string, readonly InternalObject[]> {
  const groups = new Map<string, InternalObject[]>()

  for (const record of records) {
    const key = keyFor(record)
    const values = groups.get(key)

    if (values === undefined) {
      groups.set(key, [record])
    } else {
      values.push(record)
    }
  }

  return groups
}

function objectKey(
  kind: SnapshotDiffObjectKind,
  namespace: string | undefined,
  parent: InternalObject | undefined,
  id: string,
): string {
  return objectKeyFor(kind, namespace, parent?.object.kind, parent?.object.id, id)
}

function objectKeyFor(
  kind: SnapshotDiffObjectKind,
  namespace: string | undefined,
  parentKind: SnapshotDiffObjectKind | undefined,
  parentId: string | undefined,
  id: string,
): string {
  return `${kind}\u0000${namespace ?? ""}\u0000${parentKind ?? ""}\u0000${parentId ?? ""}\u0000${id}`
}

function addParentRenameMapping(match: Match, mappings: Map<string, string>): void {
  const before = match.before.object
  const after = match.after.object
  const key = parentMappingKey(before.kind, before.namespace, before.id)
  const existing = mappings.get(key)

  if (existing === undefined || existing === after.id) {
    mappings.set(key, after.id)
  }
}

function parentMappingKey(
  kind: SnapshotDiffObjectKind,
  namespace: string | undefined,
  id: string,
): string {
  return `${kind}\u0000${namespace ?? ""}\u0000${id}`
}

function remappedObjectKey(record: InternalObject, mappings: ReadonlyMap<string, string>): string {
  const parent = record.object.parent

  if (parent === undefined) {
    return record.key
  }

  const parentNamespace = parent.namespace ?? record.object.namespace
  const parentId =
    mappings.get(parentMappingKey(parent.kind, parentNamespace, parent.id)) ?? parent.id

  return objectKeyFor(
    record.object.kind,
    record.object.namespace,
    parent.kind,
    parentId,
    record.object.id,
  )
}

function scopeKeyForRecord(
  record: InternalObject,
  mappings: ReadonlyMap<string, string> = new Map(),
): string {
  const parent = record.object.parent

  if (parent === undefined) {
    return `${record.object.kind}\u0000${record.object.namespace ?? ""}\u0000`
  }

  const parentNamespace = parent.namespace ?? record.object.namespace
  const parentId =
    mappings.get(parentMappingKey(parent.kind, parentNamespace, parent.id)) ?? parent.id

  return `${record.object.kind}\u0000${record.object.namespace ?? ""}\u0000${parentId}`
}

// Normalize only known schema paths; extension and deferred payload arrays may be
// order-sensitive and must pass through unchanged.
function sortSnapshotArrays(value: JsonRecord): JsonRecord {
  const visit = (current: unknown, path: SnapshotDiffPath): unknown => {
    if (Array.isArray(current)) {
      const values = current.map((item, index) => visit(item, [...path, index]))

      if (isObjectArrayPath(path) && values.every(isRecord)) {
        return values.sort(compareUnknownRecords)
      }

      if (isUnorderedArrayPath(path)) {
        return values.sort(compareUnknownRecords)
      }

      if (isPositionedArrayPath(path)) {
        return values.sort(comparePositionedRecords)
      }

      return values
    }

    if (!isRecord(current)) {
      return current
    }

    const output: JsonRecord = {}

    for (const [childKey, child] of Object.entries(current)) {
      output[childKey] = visit(child, [...path, childKey])
    }

    return output
  }

  return visit(value, []) as JsonRecord
}

function isObjectArrayPath(path: SnapshotDiffPath): boolean {
  if (path.length === 1) {
    return (
      path[0] === "tables" ||
      path[0] === "views" ||
      path[0] === "sequences" ||
      path[0] === "enums" ||
      path[0] === "domains" ||
      path[0] === "collations" ||
      path[0] === "triggers" ||
      path[0] === "routines" ||
      path[0] === "partitions" ||
      path[0] === "policies" ||
      path[0] === "extensions" ||
      path[0] === "deferredObjects" ||
      path[0] === "opaqueObjects" ||
      path[0] === "comments" ||
      path[0] === "ownership"
    )
  }

  if (path.length !== 3 || !Number.isSafeInteger(path[1])) {
    return false
  }

  if (path[0] === "tables") {
    return path[2] === "columns" || path[2] === "constraints" || path[2] === "indexes"
  }

  if (path[0] === "views") {
    return path[2] === "columns"
  }

  return path[0] === "domains" && path[2] === "constraints"
}

function isUnorderedArrayPath(path: SnapshotDiffPath): boolean {
  if (path.length === 3 && Number.isSafeInteger(path[1])) {
    if ((path[0] === "views" || path[0] === "routines") && path[2] === "dependencies") {
      return true
    }

    if (
      (path[0] === "policies" && path[2] === "roles") ||
      (path[0] === "triggers" && path[2] === "events")
    ) {
      return true
    }
  }

  return (
    path.length === 5 &&
    path[0] === "tables" &&
    Number.isSafeInteger(path[1]) &&
    path[2] === "indexes" &&
    Number.isSafeInteger(path[3]) &&
    path[4] === "includedColumns"
  )
}

function isPositionedArrayPath(path: SnapshotDiffPath): boolean {
  if (path.length === 3 && Number.isSafeInteger(path[1])) {
    return (
      (path[0] === "enums" && path[2] === "values") ||
      (path[0] === "routines" && path[2] === "parameters")
    )
  }

  return (
    path.length === 5 &&
    path[0] === "tables" &&
    Number.isSafeInteger(path[1]) &&
    path[2] === "indexes" &&
    Number.isSafeInteger(path[3]) &&
    path[4] === "terms"
  )
}

function compareUnknownRecords(left: unknown, right: unknown): number {
  const leftRecord = isRecord(left) ? left : undefined
  const rightRecord = isRecord(right) ? right : undefined
  const leftId = leftRecord && typeof leftRecord.id === "string" ? leftRecord.id : ""
  const rightId = rightRecord && typeof rightRecord.id === "string" ? rightRecord.id : ""

  if (leftId !== rightId) {
    return leftId < rightId ? -1 : 1
  }

  return safeString(left).localeCompare(safeString(right))
}

function comparePositionedRecords(left: unknown, right: unknown): number {
  const leftRecord = isRecord(left) ? left : undefined
  const rightRecord = isRecord(right) ? right : undefined
  const leftPosition =
    leftRecord && typeof leftRecord.position === "number"
      ? leftRecord.position
      : leftRecord && typeof leftRecord.ordinalPosition === "number"
        ? leftRecord.ordinalPosition
        : Number.MAX_SAFE_INTEGER
  const rightPosition =
    rightRecord && typeof rightRecord.position === "number"
      ? rightRecord.position
      : rightRecord && typeof rightRecord.ordinalPosition === "number"
        ? rightRecord.ordinalPosition
        : Number.MAX_SAFE_INTEGER

  return leftPosition - rightPosition || compareUnknownRecords(left, right)
}

function safeString(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

function canonicalEquivalent(left: unknown, right: unknown): boolean {
  try {
    return canonicalJson(toSnapshotJsonValue(left)) === canonicalJson(toSnapshotJsonValue(right))
  } catch {
    return safeString(left) === safeString(right)
  }
}

function normalizeRenameTarget(
  value: unknown,
  path: SnapshotDiffPath,
  diagnostics: SnapshotDiffDiagnostic[],
): SnapshotRenameTarget | undefined {
  if (typeof value === "string") {
    if (value.length === 0) {
      diagnostics.push(diffDiagnostic("invalid-rename-hint", "Rename target cannot be empty", path))
      return undefined
    }

    return freeze({ id: value })
  }

  if (!isRecord(value)) {
    diagnostics.push(
      diffDiagnostic("invalid-rename-hint", "Rename target must be a string or object", path),
    )
    return undefined
  }

  for (const key of Object.keys(value)) {
    if (key !== "id" && key !== "physicalName" && key !== "path") {
      diagnostics.push(
        diffDiagnostic("invalid-rename-hint", `Unknown rename target field "${key}"`, [
          ...path,
          key,
        ]),
      )
    }
  }

  const id = value.id
  const physicalName = value.physicalName
  const targetPath = value.path

  if (id !== undefined && (typeof id !== "string" || id.length === 0)) {
    diagnostics.push(
      diffDiagnostic("invalid-rename-hint", "Rename target id must be a non-empty string", [
        ...path,
        "id",
      ]),
    )
  }

  if (
    physicalName !== undefined &&
    (typeof physicalName !== "string" || physicalName.length === 0)
  ) {
    diagnostics.push(
      diffDiagnostic(
        "invalid-rename-hint",
        "Rename target physicalName must be a non-empty string",
        [...path, "physicalName"],
      ),
    )
  }

  if (targetPath !== undefined && !isPath(targetPath)) {
    diagnostics.push(
      diffDiagnostic("invalid-rename-hint", "Rename target path must be an array", [
        ...path,
        "path",
      ]),
    )
  }

  if (id === undefined && physicalName === undefined && targetPath === undefined) {
    diagnostics.push(
      diffDiagnostic(
        "invalid-rename-hint",
        "Rename target needs an id, physicalName, or path",
        path,
      ),
    )
    return undefined
  }

  if (
    (id !== undefined && (typeof id !== "string" || id.length === 0)) ||
    (physicalName !== undefined &&
      (typeof physicalName !== "string" || physicalName.length === 0)) ||
    (targetPath !== undefined && !isPath(targetPath))
  ) {
    return undefined
  }

  return freeze({
    ...(typeof id === "string" ? { id } : {}),
    ...(typeof physicalName === "string" ? { physicalName } : {}),
    ...(isPath(targetPath) ? { path: freeze([...targetPath]) } : {}),
  })
}

function targetKey(target: SnapshotRenameTarget): string {
  return `${target.id ?? ""}\u0000${target.physicalName ?? ""}\u0000${target.path?.join(".") ?? ""}`
}

function isObjectKind(value: unknown): value is SnapshotDiffObjectKind {
  return typeof value === "string" && objectKinds.has(value as SnapshotDiffObjectKind)
}

function isPath(value: unknown): value is SnapshotDiffPath {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string" || Number.isSafeInteger(item))
  )
}

function samePath(left: SnapshotDiffPath, right: SnapshotDiffPath): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index])
}

function compareObject(left: InternalObject, right: InternalObject): number {
  return (
    left.object.kind.localeCompare(right.object.kind) ||
    (left.object.namespace ?? "").localeCompare(right.object.namespace ?? "") ||
    (left.object.parent?.id ?? "").localeCompare(right.object.parent?.id ?? "") ||
    left.object.id.localeCompare(right.object.id) ||
    safeString(left.object.path).localeCompare(safeString(right.object.path))
  )
}

function compareOperation(left: SnapshotDiffOperation, right: SnapshotDiffOperation): number {
  return (
    (operationOrder.get(left.type) ?? 99) - (operationOrder.get(right.type) ?? 99) ||
    left.kind.localeCompare(right.kind) ||
    (left.namespace ?? "").localeCompare(right.namespace ?? "") ||
    (left.logicalId ?? "").localeCompare(right.logicalId ?? "") ||
    safeString(left.before?.path ?? left.after?.path).localeCompare(
      safeString(right.before?.path ?? right.after?.path),
    )
  )
}

function compareSuggestion(
  left: SnapshotRenameSuggestion,
  right: SnapshotRenameSuggestion,
): number {
  return (
    left.kind.localeCompare(right.kind) ||
    (left.namespace ?? "").localeCompare(right.namespace ?? "") ||
    left.before.id.localeCompare(right.before.id) ||
    left.after.id.localeCompare(right.after.id)
  )
}

function compareHint(left: SnapshotRenameHint, right: SnapshotRenameHint): number {
  return (
    left.kind.localeCompare(right.kind) ||
    (left.namespace ?? "").localeCompare(right.namespace ?? "") ||
    targetKey(normalizeTargetForCompare(left.from)).localeCompare(
      targetKey(normalizeTargetForCompare(right.from)),
    ) ||
    targetKey(normalizeTargetForCompare(left.to)).localeCompare(
      targetKey(normalizeTargetForCompare(right.to)),
    )
  )
}

function normalizeTargetForCompare(target: string | SnapshotRenameTarget): SnapshotRenameTarget {
  return typeof target === "string" ? { id: target } : target
}

function clampThreshold(value: number | undefined): number {
  return value === undefined || !Number.isFinite(value) ? 0.75 : Math.min(1, Math.max(0, value))
}

function sortDiagnostics(
  diagnostics: readonly SnapshotDiffDiagnostic[],
): readonly SnapshotDiffDiagnostic[] {
  return freeze(
    [...diagnostics].sort(
      (left, right) =>
        left.code.localeCompare(right.code) ||
        safeString(left.path).localeCompare(safeString(right.path)) ||
        left.message.localeCompare(right.message),
    ),
  )
}

function freezeDiff(value: SnapshotDiff): SnapshotDiff {
  return deepFreeze(value)
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object") {
    return value
  }

  if (seen.has(value)) {
    return value
  }

  seen.add(value)
  if (Array.isArray(value)) {
    for (const item of value) {
      deepFreeze(item, seen)
    }
  } else {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child, seen)
    }
  }

  return Object.freeze(value)
}

function freeze<T>(value: T): T {
  return deepFreeze(value)
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isSnapshotRecord(value: SnapshotJsonValue | undefined): value is SnapshotRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
