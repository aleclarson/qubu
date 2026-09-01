import { diffSnapshots, type SnapshotDiffDiagnostic, type SnapshotDiffOperation } from "qubu/diff"
import type { SchemaSnapshot, SnapshotJsonValue } from "qubu/snapshot"

import {
  sealBaselineArtifact,
  type ArtifactConstraints,
  type ArtifactProvenance,
  type VerifiedBaselineArtifact,
} from "../artifact/index.ts"
import { MigrationExecutionError } from "../executor/errors.ts"
import type { MigrationAdapter, MigrationSession, MigrationSnapshot } from "../executor/types.ts"
import { validateJournalState } from "../journal/index.ts"

export interface BaselineConfirmation {
  readonly databaseTargetVerified: true
  readonly snapshotSourceVerified: true
  readonly zeroManagedDriftVerified: true
  readonly backupRestoreReady: true
  readonly otherMigratorsStopped: true
  readonly applicationCompatible: true
  readonly legacyHistoryCutoverAccepted: true
}

export interface CreateBaselineInput {
  readonly adapter: MigrationAdapter
  readonly id: string
  readonly snapshot: MigrationSnapshot
  readonly provenance: ArtifactProvenance
  readonly confirmation: BaselineConfirmation
  readonly operator?: SnapshotJsonValue
  readonly constraints?: ArtifactConstraints
  readonly verifiedAt?: string
  readonly attemptId?: string
  readonly signal?: AbortSignal
}

export interface BaselineResult {
  readonly artifact: VerifiedBaselineArtifact
  readonly unmanagedObjects: readonly { readonly kind: string; readonly physicalName: string }[]
}

/** Verify and atomically record the first, non-executable artifact in an empty journal. */
export async function createBaseline(input: CreateBaselineInput): Promise<BaselineResult> {
  input.signal?.throwIfAborted()
  let session: MigrationSession | undefined
  let leased = false
  try {
    session = await input.adapter.openMigrationSession(input.signal)
    if (session.capabilities.dialect !== input.snapshot.dialect.name)
      throw new MigrationExecutionError(
        "capability",
        "Baseline dialect is incompatible",
        {},
        { retry: "safe" },
      )
    if (!session.readSnapshot)
      throw new MigrationExecutionError(
        "capability",
        "Adapter does not support strict snapshot inspection",
        {},
        { retry: "safe" },
      )
    await session.acquireLease(input.signal)
    leased = true
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
    )
      throw new MigrationExecutionError(
        "policy",
        "A baseline requires an empty migration journal",
        {},
        { retry: "safe" },
      )

    const inspection = await session.readSnapshot(input.snapshot)
    const comparison = compareManagedSnapshots(input.snapshot, inspection.snapshot)
    if (!comparison.matches)
      throw new MigrationExecutionError(
        "drift",
        "Live managed schema does not match the baseline snapshot",
        {},
        { retry: "safe" },
      )

    const verifiedAt = input.verifiedAt ?? new Date().toISOString()
    const artifact = await sealBaselineArtifact({
      format: "qubu-verified-baseline",
      version: 1,
      id: input.id,
      sequence: 0,
      parentArtifactDigest: null,
      dialect: input.snapshot.dialect,
      ...(input.constraints === undefined ? {} : { constraints: input.constraints }),
      snapshot: { value: input.snapshot },
      verifiedAt,
      provenance: input.provenance,
      operator: {
        confirmation: {
          databaseTargetVerified: input.confirmation.databaseTargetVerified,
          snapshotSourceVerified: input.confirmation.snapshotSourceVerified,
          zeroManagedDriftVerified: input.confirmation.zeroManagedDriftVerified,
          backupRestoreReady: input.confirmation.backupRestoreReady,
          otherMigratorsStopped: input.confirmation.otherMigratorsStopped,
          applicationCompatible: input.confirmation.applicationCompatible,
          legacyHistoryCutoverAccepted: input.confirmation.legacyHistoryCutoverAccepted,
        },
        ...(input.operator === undefined ? {} : { metadata: input.operator }),
      },
    })
    const attemptId = input.attemptId ?? `baseline-${crypto.randomUUID()}`
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
      if (!advanced) throw new Error("Migration journal head changed during baseline creation")
      await session.journal.transitionAttempt(attemptId, "applied")
      await session.commitTransaction()
    } catch (error) {
      await session.rollbackTransaction().catch(() => undefined)
      await session.journal.transitionAttempt(attemptId, "rolled_back", {
        code: "baseline-failed",
        message: error instanceof Error ? error.message : "Baseline transaction failed",
      })
      throw error
    }
    return Object.freeze({ artifact, unmanagedObjects: inspection.unmanagedObjects })
  } finally {
    if (session && leased) await session.releaseLease()
    if (session) await session.close()
  }
}

export interface ManagedSnapshotComparison {
  readonly matches: boolean
  readonly operations: readonly SnapshotDiffOperation[]
  readonly diagnostics: readonly SnapshotDiffDiagnostic[]
}

/** Compare snapshots by managed physical facts while retaining logical diff details for callers. */
export function compareManagedSnapshots(
  expected: MigrationSnapshot,
  actual: MigrationSnapshot,
): ManagedSnapshotComparison {
  const result = diffSnapshots(expected, actual)
  const expectedPhysical = physicalProjection(expected)
  const actualPhysical = physicalProjection(actual)
  const matches =
    !result.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "invalid-snapshot" || diagnostic.code === "dialect-mismatch",
    ) && JSON.stringify(expectedPhysical) === JSON.stringify(actualPhysical)
  return Object.freeze({
    matches,
    operations: result.operations,
    diagnostics: result.diagnostics,
  })
}

function physicalProjection(snapshot: SchemaSnapshot): unknown {
  const names = physicalNames(snapshot)
  return {
    dialect: snapshot.dialect,
    namespace: projectObject(record(snapshot.namespace), names, {}),
    tables: sortProjected(snapshot.tables.map((table) => projectTable(table, names))),
    views: sortProjected(
      snapshot.views.map((view) => {
        const projected = projectObject(record(view), names, {})
        projected.columns = view.columns
          .map((column) => projectObject(record(column), names, { tableId: view.id }))
          .sort(byColumnPosition)
        return projected
      }),
    ),
    sequences: sortProjected(
      snapshot.sequences.map((sequence) => projectObject(record(sequence), names, {})),
    ),
    enums: sortProjected(
      snapshot.enums.map((item) => {
        const projected = projectObject(record(item), names, {})
        projected.values = item.values.map((value) => ({
          ordinalPosition: value.ordinalPosition,
          value: value.value,
        }))
        return projected
      }),
    ),
    domains: sortProjected(
      snapshot.domains.map((domain) => {
        const projected = projectObject(record(domain), names, {})
        projected.constraints = (domain.constraints ?? [])
          .map((constraint) => projectObject(record(constraint), names, {}))
          .sort(byPhysicalName)
        return projected
      }),
    ),
    collations: sortProjected(
      snapshot.collations.map((collation) => projectObject(record(collation), names, {})),
    ),
    triggers: sortProjected(
      snapshot.triggers.map((trigger) => projectObject(record(trigger), names, {})),
    ),
    routines: sortProjected(
      snapshot.routines.map((routine) => projectObject(record(routine), names, {})),
    ),
    partitions: sortProjected(
      snapshot.partitions.map((partition) => projectObject(record(partition), names, {})),
    ),
    policies: sortProjected(
      snapshot.policies.map((policy) => projectObject(record(policy), names, {})),
    ),
    extensions: sortProjected(
      snapshot.extensions.map((extension) => projectObject(record(extension), names, {})),
    ),
    deferredObjects: sortProjected(
      snapshot.deferredObjects.map((object) => projectObject(record(object), names, {})),
    ),
    opaqueObjects: sortProjected(
      snapshot.opaqueObjects
        .filter((object) => object.objectKind !== "unknown-field")
        .map((object) => projectObject(record(object), names, {})),
    ),
    comments: sortProjected(
      snapshot.comments.map((comment) => projectObject(record(comment), names, {})),
    ),
    ownership: sortProjected(
      snapshot.ownership.map((ownership) => projectObject(record(ownership), names, {})),
    ),
  }
}

interface PhysicalNames {
  readonly dialect: string
  readonly objects: Map<string, string>
  readonly columns: Map<string, Map<string, string>>
  readonly nested: Map<string, Map<string, string>>
}

interface ProjectionContext {
  readonly tableId?: string
}

function physicalNames(snapshot: SchemaSnapshot): PhysicalNames {
  const objects = new Map<string, string>()
  const columns = new Map<string, Map<string, string>>()
  const nested = new Map<string, Map<string, string>>()

  const addObject = (kind: string, id: string, physicalName: string): void => {
    objects.set(objectKey(kind, id), physicalName)
  }
  const addNested = (tableId: string, kind: string, id: string, physicalName: string): void => {
    const values = nested.get(tableId) ?? new Map<string, string>()
    values.set(objectKey(kind, id), physicalName)
    nested.set(tableId, values)
  }

  for (const table of snapshot.tables) {
    addObject(table.kind, table.id, table.physicalName)
    const tableColumns = new Map<string, string>()
    columns.set(table.id, tableColumns)
    for (const column of table.columns) {
      tableColumns.set(column.id, column.physicalName)
      addNested(table.id, column.kind, column.id, column.physicalName)
    }
    for (const constraint of table.constraints) {
      addNested(table.id, constraint.kind, constraint.id, constraint.physicalName)
    }
    for (const index of table.indexes) {
      addNested(table.id, index.kind, index.id, index.physicalName)
    }
  }

  for (const view of snapshot.views) {
    addObject(view.kind, view.id, view.physicalName)
    const viewColumns = new Map<string, string>()
    columns.set(view.id, viewColumns)
    for (const column of view.columns) {
      viewColumns.set(column.id, column.physicalName)
    }
  }

  const groups = [
    snapshot.sequences,
    snapshot.enums,
    snapshot.domains,
    snapshot.collations,
    snapshot.triggers,
    snapshot.routines,
    snapshot.partitions,
    snapshot.policies,
    snapshot.extensions,
    snapshot.deferredObjects,
    snapshot.opaqueObjects,
    snapshot.comments,
    snapshot.ownership,
  ]
  for (const group of groups) {
    for (const object of group) {
      addObject(object.kind, object.id, object.physicalName)
    }
  }

  return { dialect: snapshot.dialect.name, objects, columns, nested }
}

function projectTable(
  table: SchemaSnapshot["tables"][number],
  names: PhysicalNames,
): Record<string, unknown> {
  const projected = projectObject(record(table), names, { tableId: table.id })
  projected.columns = table.columns
    .map((column) => projectObject(record(column), names, { tableId: table.id }))
    .sort(byColumnPosition)
  projected.constraints = table.constraints
    .map((constraint) => projectObject(record(constraint), names, { tableId: table.id }))
    .sort(byPhysicalName)
  projected.indexes = table.indexes
    .map((index) => projectObject(record(index), names, { tableId: table.id }))
    .sort(byPhysicalName)
  return projected
}

function projectObject(
  value: Record<string, unknown>,
  names: PhysicalNames,
  context: ProjectionContext,
): Record<string, unknown> {
  const tableId = context.tableId ?? referenceId(value.table) ?? referenceId(value.parent)
  const localContext = tableId === undefined ? context : { tableId }
  const projected: Record<string, unknown> = {}

  for (const key of Object.keys(value).sort()) {
    if (key === "id" || key === "provenance" || key === "physicalReference" || key === "dialect") {
      continue
    }
    projected[key] = projectProperty(key, value[key], names, localContext)
  }

  if (value.kind === "foreign-key") {
    projected.onUpdate ??= "no-action"
    projected.onDelete ??= "no-action"
    projected.match ??= "simple"
  }

  return projected
}

function projectProperty(
  key: string,
  value: unknown,
  names: PhysicalNames,
  context: ProjectionContext,
): unknown {
  if (key === "storage") {
    return physicalStorageType(
      names.dialect,
      value as SchemaSnapshot["tables"][number]["columns"][number]["storage"],
    )
  }

  if (key === "identity" && isRecord(value)) {
    const dialect = isRecord(value.dialect) ? value.dialect : undefined
    const data = dialect !== undefined && isRecord(dialect.data) ? dialect.data : undefined
    return {
      autoIncrement: dialect?.dialect === "sqlite" && data?.autoIncrement === true,
      generation: value.generation,
    }
  }

  if (key === "columns" || key === "includedColumns" || key === "keyColumns") {
    return Array.isArray(value)
      ? value.map((item) =>
          typeof item === "string"
            ? resolveColumn(item, context.tableId, names)
            : projectNested(item),
        )
      : projectNested(value)
  }

  if (key === "terms" && Array.isArray(value)) {
    return value
      .map((term) => {
        const projected = projectNested(term)
        if (!isRecord(projected) || !isRecord(term)) return projected
        if (term.kind === "column" && typeof term.column === "string") {
          projected.column = resolveColumn(term.column, context.tableId, names)
        }
        return projected
      })
      .sort(byTermPosition)
  }

  if (key === "target" && isRecord(value)) {
    const targetTableId = referenceId(value.table)
    return {
      table: projectReference(value.table, names, context),
      columns: Array.isArray(value.columns)
        ? value.columns.map((column) =>
            typeof column === "string"
              ? resolveColumn(column, targetTableId, names)
              : projectNested(column),
          )
        : projectNested(value.columns),
    }
  }

  if (
    key === "backingIndex" ||
    key === "backingConstraint" ||
    key === "ownedBy" ||
    key === "table" ||
    key === "parent" ||
    key === "object"
  ) {
    return projectReference(value, names, context)
  }

  if (key === "dependencies" && Array.isArray(value)) {
    return value.map((item) => projectReference(item, names, context)).sort(compareJson)
  }

  return projectNested(value)
}

function projectReference(
  value: unknown,
  names: PhysicalNames,
  context: ProjectionContext,
): unknown {
  if (!isRecord(value) || typeof value.kind !== "string" || typeof value.id !== "string") {
    return projectNested(value)
  }

  const physicalName = resolveObjectName(value.kind, value.id, context, names)
  return {
    kind: value.kind,
    ...(physicalName === undefined ? { id: value.id } : { physicalName }),
  }
}

function resolveObjectName(
  kind: string,
  id: string,
  context: ProjectionContext,
  names: PhysicalNames,
): string | undefined {
  if (context.tableId !== undefined) {
    const nestedName = names.nested.get(context.tableId)?.get(objectKey(kind, id))
    if (nestedName !== undefined) return nestedName
    const columnName = names.columns.get(context.tableId)?.get(id)
    if (kind === "column" && columnName !== undefined) return columnName
  }
  return names.objects.get(objectKey(kind, id))
}

function resolveColumn(id: string, tableId: string | undefined, names: PhysicalNames): string {
  return (tableId === undefined ? undefined : names.columns.get(tableId)?.get(id)) ?? id
}

function referenceId(value: unknown): string | undefined {
  return isRecord(value) && typeof value.id === "string" ? value.id : undefined
}

function projectNested(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(projectNested)
  if (!isRecord(value)) return value

  const result: Record<string, unknown> = {}
  for (const key of Object.keys(value).sort()) {
    result[key] = projectNested(value[key])
  }
  return result
}

function record(value: object): Record<string, unknown> {
  return value as Record<string, unknown>
}

function objectKey(kind: string, id: string): string {
  return `${kind}\u0000${id}`
}

function sortProjected(values: Record<string, unknown>[]): Record<string, unknown>[] {
  return values.sort(byPhysicalName)
}

function byColumnPosition(left: Record<string, unknown>, right: Record<string, unknown>): number {
  const leftPosition = typeof left.ordinalPosition === "number" ? left.ordinalPosition : 0
  const rightPosition = typeof right.ordinalPosition === "number" ? right.ordinalPosition : 0
  return leftPosition - rightPosition || byPhysicalName(left, right)
}

function byTermPosition(left: unknown, right: unknown): number {
  const leftPosition = isRecord(left) && typeof left.position === "number" ? left.position : 0
  const rightPosition = isRecord(right) && typeof right.position === "number" ? right.position : 0
  return leftPosition - rightPosition || compareJson(left, right)
}

function compareJson(left: unknown, right: unknown): number {
  return String(JSON.stringify(left)).localeCompare(String(JSON.stringify(right)))
}

function physicalStorageType(
  dialect: string,
  storage: SchemaSnapshot["tables"][number]["columns"][number]["storage"],
): string | undefined {
  if (storage === undefined) return undefined
  if (storage.kind === "native") return storage.type.trim().toUpperCase()
  if (dialect === "sqlite") {
    return (
      (
        {
          integer: "INTEGER",
          numeric: "NUMERIC",
          text: "TEXT",
          boolean: "INTEGER",
          date: "TEXT",
          timestamp: "TEXT",
          uuid: "TEXT",
          json: "TEXT",
          bigint: "INTEGER",
          binary: "BLOB",
        } as Record<string, string>
      )[storage.type.toLowerCase()] ?? storage.type.toUpperCase()
    )
  }
  return storage.type.toUpperCase()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function byPhysicalName(left: Record<string, unknown>, right: Record<string, unknown>): number {
  const leftName = typeof left.physicalName === "string" ? left.physicalName : ""
  const rightName = typeof right.physicalName === "string" ? right.physicalName : ""
  return leftName.localeCompare(rightName) || compareJson(left, right)
}
