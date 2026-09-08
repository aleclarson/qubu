export type { BaselineAdapter, BaselineSession } from "./adapter.ts"
export { fromMigrationAdapter } from "./migration-adapter.ts"

import {
  diffSnapshots,
  type SnapshotDiffDiagnostic,
  type SnapshotDiffObject,
  type SnapshotDiffOperation,
} from "qubu/diff"
import {
  assertSchemaSnapshot,
  encodeSchemaSnapshot,
  type SchemaSnapshot,
  type SnapshotJsonValue,
} from "qubu/snapshot"

import {
  sealBaselineArtifact,
  type ArtifactConstraints,
  type ArtifactProvenance,
  type VerifiedBaselineArtifact,
} from "../artifact/index.ts"
import { MigrationExecutionError } from "../executor/errors.ts"
import type { MigrationSnapshot, MigrationSnapshotInspection } from "../executor/types.ts"
import { verifyArtifactChain, type ArtifactRepository } from "../repository/index.ts"
import type { BaselineAdapter, BaselineSession } from "./adapter.ts"

/** Operator acknowledgments for adopting the reviewed live schema. */
export interface BaselineConfirmation {
  readonly databaseTargetVerified: true
  readonly snapshotSourceVerified: true
  readonly zeroManagedDriftVerified: true
  readonly backupRestoreReady: true
  readonly otherMigratorsStopped: true
  readonly incompatibleApplicationPrevented: true
  readonly legacyHistoryCutoverAccepted: true
}

/** Strict inspection using the original configured managed scope, including currently absent tables. */
export interface CaptureBaselineInput {
  readonly adapter: BaselineAdapter
  readonly scope: MigrationSnapshot
  readonly signal?: AbortSignal
}

/** A reviewed snapshot and the unchanged scope used to capture it. */
export interface VerifyBaselineInput extends CaptureBaselineInput {
  readonly candidate: MigrationSnapshot
  readonly repository: ArtifactRepository | readonly (string | unknown)[]
}

/** Inputs for recording a reviewed candidate as the first baseline. */
export interface CreateBaselineInput extends VerifyBaselineInput {
  readonly id: string
  readonly provenance: ArtifactProvenance
  readonly confirmation: BaselineConfirmation
  readonly operator?: SnapshotJsonValue
  readonly constraints?: ArtifactConstraints
  readonly verifiedAt?: string
  readonly attemptId?: string
}

/** Recorded baseline and live objects outside the managed selection. */
export interface BaselineResult {
  readonly artifact: VerifiedBaselineArtifact
  readonly unmanagedObjects: readonly {
    readonly kind: string
    readonly physicalName: string
  }[]
}

/**
 * Capture actual managed catalog facts without recording migration history. Session setup and lease
 * bookkeeping may write adapter-owned journal objects. Preserve the original scope for later
 * preflight and acceptance.
 */
export async function captureBaseline(
  input: CaptureBaselineInput,
): Promise<MigrationSnapshotInspection> {
  return withBaselineSession(input, (session) => session.readSnapshot(input.scope))
}

/**
 * Reinspect and reject any canonical snapshot difference or nonempty history without recording.
 * Metadata differences also require recapture; this does not perform SQL equivalence detection.
 * Session setup and lease bookkeeping may write adapter-owned journal objects.
 */
export async function preflightBaseline(
  input: VerifyBaselineInput,
): Promise<MigrationSnapshotInspection> {
  return withBaselineSession(input, (session) => verifyBaseline(session, input))
}

async function withBaselineSession<T>(
  input: CaptureBaselineInput,
  action: (session: BaselineSession) => Promise<T>,
): Promise<T> {
  input.signal?.throwIfAborted()
  assertSchemaSnapshot(input.scope)
  let session: BaselineSession | undefined

  try {
    session = await input.adapter.openBaselineSession(input.scope, input.signal)
    input.signal?.throwIfAborted()
    if (session.dialect !== input.scope.dialect.name) {
      throw new MigrationExecutionError(
        "capability",
        "Baseline dialect is incompatible",
        {},
        { retry: "safe" },
      )
    }

    return await action(session)
  } catch (error) {
    await session?.close().catch(() => undefined)
    session = undefined
    throw error
  } finally {
    await session?.close()
  }
}

async function verifyBaseline(
  session: BaselineSession,
  input: VerifyBaselineInput,
): Promise<MigrationSnapshotInspection> {
  assertSchemaSnapshot(input.candidate)
  const managedNames = new Set(input.scope.tables.map((table) => table.physicalName))
  const outsideScope = input.candidate.tables.filter(
    (table) => !managedNames.has(table.physicalName),
  )

  if (outsideScope.length) {
    throw new MigrationExecutionError(
      "policy",
      "Candidate contains tables outside the configured managed scope",
      {},
      {
        retry: "safe",
        details: { tables: outsideScope.map((table) => table.physicalName) },
      },
    )
  }

  const chain = await verifyArtifactChain(input.repository)

  if (!chain.ok) {
    throw new MigrationExecutionError(
      "validation",
      "Artifact repository validation failed",
      {},
      {
        retry: "safe",
        details: chain.diagnostics,
      },
    )
  }

  if (chain.artifacts.length) {
    throw new MigrationExecutionError(
      "policy",
      "A baseline requires an empty artifact repository",
      {},
      { retry: "safe" },
    )
  }

  await session.assertEmptyHistory()
  input.signal?.throwIfAborted()

  // Use the capture scope, not the candidate's present tables: absent tables may have appeared.
  const inspection = await session.readSnapshot(input.scope)
  const comparison = compareManagedSnapshots(input.candidate, inspection.snapshot)

  // Adoption compares captured evidence exactly, including dialect facts ignored by ordinary drift checks.
  if (encodeSchemaSnapshot(input.candidate) !== encodeSchemaSnapshot(inspection.snapshot)) {
    throw new MigrationExecutionError(
      "drift",
      "Live managed schema differs from the reviewed candidate; recapture and review before accepting",
      {},
      {
        retry: "safe",
        details: {
          comparison,
          actualSnapshot: inspection.snapshot,
          unmanagedObjects: inspection.unmanagedObjects,
        },
      },
    )
  }

  return inspection
}

/** Repeat preflight, then ask the adapter to durably record the first non-executable baseline. */
export async function createBaseline(input: CreateBaselineInput): Promise<BaselineResult> {
  const facts: readonly (keyof BaselineConfirmation)[] = [
    "databaseTargetVerified",
    "snapshotSourceVerified",
    "zeroManagedDriftVerified",
    "backupRestoreReady",
    "otherMigratorsStopped",
    "incompatibleApplicationPrevented",
    "legacyHistoryCutoverAccepted",
  ]

  if (facts.some((fact) => input.confirmation?.[fact] !== true)) {
    throw new MigrationExecutionError(
      "policy",
      "Baseline requires all seven exact confirmation facts",
      {},
      { retry: "safe" },
    )
  }

  return withBaselineSession(input, async (session) => {
    const inspection = await verifyBaseline(session, input)
    const verifiedAt = input.verifiedAt ?? new Date().toISOString()
    const artifact = await sealBaselineArtifact({
      format: "qubu-verified-baseline",
      version: 1,
      id: input.id,
      sequence: 0,
      parentArtifactDigest: null,
      dialect: input.candidate.dialect,
      ...(input.constraints === undefined ? {} : { constraints: input.constraints }),
      snapshot: { value: input.candidate },
      verifiedAt,
      provenance: input.provenance,
      operator: {
        confirmation: {
          databaseTargetVerified: input.confirmation.databaseTargetVerified,
          snapshotSourceVerified: input.confirmation.snapshotSourceVerified,
          zeroManagedDriftVerified: input.confirmation.zeroManagedDriftVerified,
          backupRestoreReady: input.confirmation.backupRestoreReady,
          otherMigratorsStopped: input.confirmation.otherMigratorsStopped,
          incompatibleApplicationPrevented: input.confirmation.incompatibleApplicationPrevented,
          legacyHistoryCutoverAccepted: input.confirmation.legacyHistoryCutoverAccepted,
        },
        ...(input.operator === undefined ? {} : { metadata: input.operator }),
      },
    })

    input.signal?.throwIfAborted()
    await session.recordBaseline(artifact, input.attemptId ?? `baseline-${crypto.randomUUID()}`)

    return Object.freeze({
      artifact,
      unmanagedObjects: inspection.unmanagedObjects,
    })
  })
}

export interface ManagedSnapshotComparison {
  readonly matches: boolean
  readonly operations: readonly SnapshotDiffOperation[]
  readonly diagnostics: readonly SnapshotDiffDiagnostic[]
}

/** Compare snapshots and report changes using the same managed physical facts. */
export function compareManagedSnapshots(
  expected: MigrationSnapshot,
  actual: MigrationSnapshot,
): ManagedSnapshotComparison {
  const raw = diffSnapshots(expected, actual)

  if (
    raw.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "invalid-snapshot" || diagnostic.code === "dialect-mismatch",
    )
  ) {
    return Object.freeze({
      matches: false,
      operations: raw.operations,
      diagnostics: raw.diagnostics,
    })
  }

  const withoutCreateSql = (snapshot: SchemaSnapshot): SchemaSnapshot => ({
    ...snapshot,
    opaqueObjects: snapshot.opaqueObjects.filter((object) => !isCreateSqlMetadata(record(object))),
  })
  const result = diffSnapshots(withoutCreateSql(expected), withoutCreateSql(actual))
  const expectedPhysical = physicalProjection(expected)
  const actualPhysical = physicalProjection(actual)
  const matches = JSON.stringify(expectedPhysical) === JSON.stringify(actualPhysical)
  const operations = Object.freeze(
    result.operations.flatMap((operation) => {
      const before = operation.before
      const after = operation.after
      const left = before === undefined ? undefined : projectDiffObject(before, expected)
      const right = after === undefined ? undefined : projectDiffObject(after, actual)

      if (before && after) {
        if (JSON.stringify(left) === JSON.stringify(right)) {
          return []
        }
        const changedProperties = [...new Set([...Object.keys(left!), ...Object.keys(right!)])]
          .sort()
          .filter((key) => JSON.stringify(left![key]) !== JSON.stringify(right![key]))
          .map((key) => ({
            path: [key],
            ...(left![key] === undefined ? {} : { before: left![key] as SnapshotJsonValue }),
            ...(right![key] === undefined ? {} : { after: right![key] as SnapshotJsonValue }),
          }))

        return [
          Object.freeze({
            ...operation,
            changedProperties: Object.freeze(changedProperties),
          }),
        ]
      }

      const object = before ?? after

      if (!object) {
        return [operation]
      }
      const other = physicalCounterpart(object, before ? actual : expected)

      if (
        other &&
        JSON.stringify(before ? left : right) ===
          JSON.stringify(projectDiffObject(other, before ? actual : expected))
      ) {
        return []
      }
      return [operation]
    }),
  )
  const diagnostics = result.diagnostics.filter((diagnostic) => {
    if (diagnostic.code === "invalid-snapshot" || diagnostic.code === "dialect-mismatch") {
      return true
    }
    if (diagnostic.code !== "destructive") {
      return true
    }
    return operations.some(
      (operation) =>
        operation.kind === diagnostic.kind &&
        (operation.before?.id === diagnostic.logicalId ||
          operation.after?.id === diagnostic.logicalId) &&
        JSON.stringify(operation.path) === JSON.stringify(diagnostic.path),
    )
  })

  return Object.freeze({
    matches,
    operations,
    diagnostics: Object.freeze(diagnostics),
  })
}

function isCreateSqlMetadata(value: Readonly<Record<string, unknown>> | undefined): boolean {
  return (
    value?.kind === "opaque-object" &&
    value.objectKind === "unknown-field" &&
    isRecord(value.data) &&
    value.data.field === "createSql" &&
    value.data.ownerKind === "table" &&
    typeof value.data.value === "string"
  )
}

function projectDiffObject(
  object: SnapshotDiffObject,
  snapshot: SchemaSnapshot,
): Record<string, unknown> {
  const projected = projectObject(record(object.value), physicalNames(snapshot), {
    tableId: object.parent?.id,
  })

  // Child records have their own diff operations.
  if (object.kind === "table" || object.kind === "view" || object.kind === "materialized-view") {
    delete projected.columns
    delete projected.constraints
    delete projected.indexes
  } else if (object.kind === "domain") {
    delete projected.constraints
  }
  return projected
}

function physicalCounterpart(
  object: SnapshotDiffObject,
  snapshot: SchemaSnapshot,
): SnapshotDiffObject | undefined {
  const group = object.path[0]

  if (typeof group !== "string") {
    return undefined
  }
  if (group === "namespace") {
    return { ...object, value: record(snapshot.namespace) as SnapshotDiffObject["value"] }
  }
  const collection = record(snapshot)[group]

  if (!Array.isArray(collection)) {
    return undefined
  }
  let values = collection
  let parent = object.parent

  if (parent) {
    const owner = collection.find((value) => value.physicalName === parent!.physicalName)
    const childGroup = object.path[2]

    if (!owner || typeof childGroup !== "string" || !Array.isArray(owner[childGroup])) {
      return undefined
    }
    values = owner[childGroup]
    parent = {
      ...parent,
      id: owner.id,
    }
  }

  const candidates = values.filter(
    (value) =>
      value.physicalName === object.physicalName &&
      value.kind === object.value.kind &&
      (object.observedKind === undefined || value.objectKind === object.observedKind),
  )

  if (candidates.length !== 1) {
    return undefined
  }
  return {
    ...object,
    id: candidates[0].id,
    value: candidates[0],
    parent,
  }
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
        .filter((object) => !isCreateSqlMetadata(record(object)))
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

  return projectNested(projected) as Record<string, unknown>
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
