import type {
  SnapshotDiffObjectKind,
  SnapshotDiffObjectReference,
  SnapshotDiffPath,
} from "qubu/diff"
import { canonicalJson } from "qubu/snapshot"
import type { SchemaSnapshot, SnapshotJsonValue } from "qubu/snapshot"

import type { MigrationPrecondition, MigrationPreconditionType } from "./types.ts"

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

const preconditionTypes = new Set<MigrationPreconditionType>([
  "snapshot-fingerprint",
  "object-present",
  "object-absent",
  "property-equals",
])

type SnapshotRecord = Readonly<Record<string, SnapshotJsonValue>>

interface SnapshotCandidate {
  readonly kind: SnapshotDiffObjectKind
  readonly namespace: string
  readonly id: string
  readonly physicalName?: string
  readonly parent?: SnapshotDiffObjectReference
  readonly value: SnapshotRecord
}

/** Evaluate a serialized migration precondition against the current managed snapshot. */
export function evaluateMigrationPrecondition(snapshot: SchemaSnapshot, value: unknown): boolean {
  if (!isMigrationPrecondition(value)) {
    return false
  }
  if (value.type === "snapshot-fingerprint") {
    return (
      value.fingerprint !== undefined &&
      fingerprintJson(snapshot as unknown as SnapshotJsonValue) === value.fingerprint
    )
  }

  // An absence guard must identify a supported object; an invalid selector is not absence.
  if (
    value.kind === "custom-sql" ||
    (value.logicalId === undefined && value.physicalName === undefined)
  ) {
    return false
  }

  const matches = collectSnapshotCandidates(snapshot).filter((candidate) =>
    matchesCondition(value, candidate),
  )

  if (value.type === "object-absent") {
    return matches.length === 0
  }
  if (matches.length !== 1) {
    return false
  }

  const candidate = matches[0]!

  if (value.type === "object-present") {
    return value.fingerprint === undefined || fingerprintJson(candidate.value) === value.fingerprint
  }

  if (value.value === undefined || value.property === undefined) {
    return false
  }
  const current = valueAtPath(candidate.value, value.property)

  return current !== undefined && canonicalJson(current) === canonicalJson(value.value)
}

/** Validate the structured value carried by an object or property program condition. */
export function isMigrationPrecondition(value: unknown): value is MigrationPrecondition {
  if (!isRecord(value)) {
    return false
  }
  if (!isPreconditionType(value.type) || !isPath(value.path) || !isPreconditionKind(value.kind)) {
    return false
  }

  if (value.namespace !== undefined && typeof value.namespace !== "string") {
    return false
  }
  if (value.logicalId !== undefined && typeof value.logicalId !== "string") {
    return false
  }
  if (value.physicalName !== undefined && typeof value.physicalName !== "string") {
    return false
  }
  if (value.fingerprint !== undefined && typeof value.fingerprint !== "string") {
    return false
  }
  if (value.property !== undefined && !isPath(value.property)) {
    return false
  }
  if (value.parent !== undefined && !isObjectReference(value.parent)) {
    return false
  }
  return value.value === undefined || isSnapshotJsonValue(value.value)
}

function collectSnapshotCandidates(snapshot: SchemaSnapshot): readonly SnapshotCandidate[] {
  const candidates: SnapshotCandidate[] = []
  const namespace = snapshot.namespace.name

  addCandidate(candidates, "namespace", snapshot.namespace, namespace)

  for (const table of snapshot.tables) {
    addCandidate(candidates, "table", table, namespace)
    const parent = reference("table", table.id, namespace)

    for (const column of table.columns) {
      addCandidate(candidates, "column", column, namespace, parent)
    }
    for (const constraint of table.constraints) {
      addCandidate(candidates, "constraint", constraint, namespace, parent)
    }
    for (const index of table.indexes) {
      addCandidate(candidates, "index", index, namespace, parent)
    }
  }

  for (const view of snapshot.views) {
    const kind = view.kind === "materialized-view" ? "materialized-view" : "view"

    addCandidate(candidates, kind, view, namespace)
    const parent = reference(kind, view.id, namespace)

    for (const column of view.columns) {
      addCandidate(candidates, "column", column, namespace, parent)
    }
  }

  for (const domain of snapshot.domains) {
    addCandidate(candidates, "domain", domain, namespace)
    const parent = reference("domain", domain.id, namespace)

    for (const constraint of domain.constraints ?? []) {
      addCandidate(candidates, "constraint", constraint, namespace, parent)
    }
  }

  const groups: readonly [SnapshotDiffObjectKind, readonly unknown[]][] = [
    ["sequence", snapshot.sequences],
    ["enum", snapshot.enums],
    ["collation", snapshot.collations],
    ["trigger", snapshot.triggers],
    ["routine", snapshot.routines],
    ["partition", snapshot.partitions],
    ["policy", snapshot.policies],
    ["extension", snapshot.extensions],
    ["deferred-object", snapshot.deferredObjects],
    ["opaque-object", snapshot.opaqueObjects],
    ["comment", snapshot.comments],
    ["ownership", snapshot.ownership],
  ]

  for (const [kind, values] of groups) {
    for (const value of values) {
      addCandidate(candidates, kind, value, namespace)
    }
  }

  return candidates
}

function addCandidate(
  candidates: SnapshotCandidate[],
  kind: SnapshotDiffObjectKind,
  value: unknown,
  namespace: string,
  parent?: SnapshotDiffObjectReference,
): void {
  if (!isRecord(value)) {
    return
  }
  const id =
    kind === "namespace"
      ? typeof value.name === "string"
        ? value.name
        : undefined
      : typeof value.id === "string"
        ? value.id
        : undefined

  if (id === undefined) {
    return
  }
  const physicalName =
    kind === "namespace"
      ? typeof value.name === "string"
        ? value.name
        : undefined
      : typeof value.physicalName === "string"
        ? value.physicalName
        : undefined

  candidates.push({
    kind,
    namespace,
    id,
    ...(physicalName === undefined ? {} : { physicalName }),
    ...(parent === undefined ? {} : { parent }),
    value: value as SnapshotRecord,
  })
}

function matchesCondition(condition: MigrationPrecondition, candidate: SnapshotCandidate): boolean {
  if (condition.kind !== candidate.kind) {
    return false
  }
  if (condition.namespace !== undefined && condition.namespace !== candidate.namespace) {
    return false
  }
  if (condition.logicalId === undefined && condition.physicalName === undefined) {
    return false
  }
  if (
    condition.logicalId !== undefined &&
    condition.logicalId !== candidate.id &&
    !(condition.type === "object-absent" && condition.physicalName !== undefined)
  ) {
    return false
  }
  if (condition.physicalName !== undefined && condition.physicalName !== candidate.physicalName) {
    return false
  }

  return sameReference(condition.parent, candidate.parent)
}

function valueAtPath(
  value: SnapshotJsonValue,
  path: SnapshotDiffPath,
): SnapshotJsonValue | undefined {
  let current: SnapshotJsonValue | undefined = value

  for (const segment of path) {
    if (typeof segment === "number") {
      if (!Array.isArray(current)) {
        return undefined
      }
      current = current[segment]
    } else {
      if (!isRecord(current)) {
        return undefined
      }
      current = current[segment]
    }
  }

  return current
}

function sameReference(
  expected: SnapshotDiffObjectReference | undefined,
  actual: SnapshotDiffObjectReference | undefined,
): boolean {
  if (expected === undefined || actual === undefined) {
    return expected === actual
  }
  return (
    expected.kind === actual.kind &&
    expected.id === actual.id &&
    (expected.namespace === undefined ||
      actual.namespace === undefined ||
      expected.namespace === actual.namespace)
  )
}

function reference(
  kind: SnapshotDiffObjectKind,
  id: string,
  namespace: string,
): SnapshotDiffObjectReference {
  return {
    kind,
    id,
    namespace,
  }
}

function isPreconditionType(value: unknown): value is MigrationPreconditionType {
  return typeof value === "string" && preconditionTypes.has(value as MigrationPreconditionType)
}

function isPreconditionKind(value: unknown): value is MigrationPrecondition["kind"] {
  return (
    value === "custom-sql" ||
    (typeof value === "string" && objectKinds.has(value as SnapshotDiffObjectKind))
  )
}

function isObjectReference(value: unknown): value is SnapshotDiffObjectReference {
  return (
    isRecord(value) &&
    typeof value.kind === "string" &&
    objectKinds.has(value.kind as SnapshotDiffObjectKind) &&
    typeof value.id === "string" &&
    (value.namespace === undefined || typeof value.namespace === "string")
  )
}

function isPath(value: unknown): value is SnapshotDiffPath {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === "string" || (typeof item === "number" && Number.isSafeInteger(item)),
    )
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isSnapshotJsonValue(value: unknown): value is SnapshotJsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return true
  }
  if (typeof value === "number") {
    return Number.isFinite(value)
  }
  if (Array.isArray(value)) {
    return value.every(isSnapshotJsonValue)
  }
  if (!isRecord(value)) {
    return false
  }
  return Object.values(value).every(isSnapshotJsonValue)
}

function fingerprintJson(value: SnapshotJsonValue): string {
  return fingerprintText(canonicalJson(value))
}

function fingerprintText(source: string): string {
  let hash = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  const mask = 0xffffffffffffffffn

  for (const byte of new TextEncoder().encode(source)) {
    hash ^= BigInt(byte)
    hash = (hash * prime) & mask
  }

  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`
}
