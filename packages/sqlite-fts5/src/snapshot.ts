import type { Schema as QubuSchema } from "qubu/schema"
import { assertSchemaSnapshot, toSnapshotJsonValue } from "qubu/snapshot"
import type {
  CompleteSnapshotDeferredObject,
  CompleteSnapshotOpaqueObject,
  SchemaSnapshot,
  SnapshotJsonValue,
} from "qubu/snapshot"
import { createSchemaSnapshot } from "qubu/snapshot/sqlite"

import type { Fts5Definition, Fts5Source } from "./table.ts"

const fts5ObjectKind = "sqlite-fts5"
const fts5ExpressionKind = "sqlite-fts5-create"

/** Create a SQLite schema snapshot and add the declared FTS5 virtual tables to it. */
export function create<TSchema extends QubuSchema<any>>(
  schema: TSchema,
  sources: readonly Fts5Source[],
): SchemaSnapshot {
  return add(createSchemaSnapshot(schema), sources)
}

/** Add addon-owned FTS5 opaque objects to an existing canonical SQLite snapshot. */
export function add(snapshot: SchemaSnapshot, sources: readonly Fts5Source[]): SchemaSnapshot {
  assertSqliteSnapshot(snapshot)
  const definitions = uniqueDefinitions(sources)

  return replaceManagedObjects(snapshot, definitions)
}

/**
 * Adopt matching FTS5 virtual/shadow-table records from a live SQLite introspection snapshot. A
 * changed or unrecognized CREATE statement is left untouched so migration remains reviewable.
 */
export function normalize(
  snapshot: SchemaSnapshot,
  sources: readonly Fts5Source[],
): SchemaSnapshot {
  assertSqliteSnapshot(snapshot)
  const definitions = uniqueDefinitions(sources).filter((definition) => {
    const observed = [...snapshot.deferredObjects, ...snapshot.opaqueObjects].find(
      (object) => object.physicalName === definition.name,
    )

    return observed !== undefined && sameSql(observedCreateSql(observed), definition.createSql)
  })

  return definitions.length === 0 ? snapshot : replaceManagedObjects(snapshot, definitions)
}

/** Convert one addon definition to the canonical opaque snapshot boundary. */
export function objectFor(definition: Fts5Definition): CompleteSnapshotOpaqueObject {
  return {
    kind: "opaque-object",
    id: objectId(definition.name),
    objectKind: fts5ObjectKind,
    physicalName: definition.name,
    data: definitionData(definition),
    sql: {
      kind: "expression",
      expressionKind: fts5ExpressionKind,
      sql: definition.createSql,
    },
    provenance: {
      kind: "create-sql",
      dialect: "sqlite",
    },
  }
}

export function isObject(value: unknown): value is CompleteSnapshotOpaqueObject {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    value.kind === "opaque-object" &&
    "objectKind" in value &&
    value.objectKind === fts5ObjectKind
  )
}

export function objectId(name: string): string {
  return `${fts5ObjectKind}:${name}`
}

function replaceManagedObjects(
  snapshot: SchemaSnapshot,
  definitions: readonly Fts5Definition[],
): SchemaSnapshot {
  const managedNames = new Set(
    definitions.flatMap((definition) => [
      definition.name,
      ...definition.shadowNames,
      ...definition.triggerNames,
    ]),
  )
  const managedTriggers = new Set(definitions.flatMap((definition) => definition.triggerNames))
  const opaqueObjects = [
    ...snapshot.opaqueObjects.filter((object) => !managedNames.has(object.physicalName)),
    ...definitions.map(objectFor),
  ].sort(comparePhysicalObject)
  const deferredObjects = snapshot.deferredObjects.filter(
    (object) => !managedNames.has(object.physicalName),
  )
  const triggers = snapshot.triggers.filter((trigger) => !managedTriggers.has(trigger.physicalName))

  return assertSchemaSnapshot({
    ...snapshot,
    triggers,
    deferredObjects,
    opaqueObjects,
  })
}

function definitionData(definition: Fts5Definition): SnapshotJsonValue {
  const data: Record<string, unknown> = {
    module: "fts5",
    version: 1,
    name: definition.name,
    columns: definition.columns.map((column) => ({
      fieldName: column.fieldName,
      name: column.name,
      unindexed: column.unindexed,
      ...(column.sourceColumn === undefined ? {} : { sourceColumn: column.sourceColumn }),
    })),
    content: definition.content,
    sync: definition.sync,
    shadowNames: definition.shadowNames,
    triggerNames: definition.triggerNames,
    statements: {
      install: definition.installSql,
      uninstall: definition.uninstallSql,
    },
  }

  if (definition.tokenize !== undefined) {
    data.tokenize = definition.tokenize
  }

  if (definition.prefix !== undefined) {
    data.prefix = definition.prefix
  }

  if (definition.detail !== undefined) {
    data.detail = definition.detail
  }

  if (definition.columnsize !== undefined) {
    data.columnsize = definition.columnsize
  }

  if (definition.contentlessDelete !== undefined) {
    data.contentlessDelete = definition.contentlessDelete
  }

  return toSnapshotJsonValue(data)
}

function uniqueDefinitions(sources: readonly Fts5Source[]): readonly Fts5Definition[] {
  const definitions = sources.map((source) => source.fts5)
  const names = new Set<string>()

  for (const definition of definitions) {
    if (names.has(definition.name)) {
      throw new TypeError(`Duplicate FTS5 table "${definition.name}"`)
    }

    names.add(definition.name)
  }

  return definitions
}

function assertSqliteSnapshot(snapshot: SchemaSnapshot): void {
  if (snapshot.dialect.name !== "sqlite") {
    throw new TypeError(`FTS5 snapshots require SQLite, received "${snapshot.dialect.name}"`)
  }
}

function observedCreateSql(
  object: CompleteSnapshotDeferredObject | CompleteSnapshotOpaqueObject,
): string | undefined {
  if (object.kind === "opaque-object") {
    return object.sql?.sql
  }

  const data = object.data

  if (data === undefined || !isSnapshotRecord(data)) {
    return undefined
  }

  const createSql = data.createSql

  return typeof createSql === "string" ? createSql : undefined
}

function sameSql(left: string | undefined, right: string): boolean {
  if (left === undefined) {
    return false
  }

  return normalizeSql(left) === normalizeSql(right)
}

function normalizeSql(sql: string): string {
  return sql.trim().replace(/;+$/u, "").replace(/\s+/gu, " ").toLowerCase()
}

function isSnapshotRecord(
  value: SnapshotJsonValue,
): value is { readonly [key: string]: SnapshotJsonValue } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !Object.hasOwn(value, "$number") &&
    !Object.hasOwn(value, "$bigint")
  )
}

function comparePhysicalObject(
  left: CompleteSnapshotOpaqueObject,
  right: CompleteSnapshotOpaqueObject,
): number {
  return left.physicalName.localeCompare(right.physicalName)
}
