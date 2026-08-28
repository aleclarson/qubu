import type {
  CatalogColumn,
  CatalogConstraint,
  CatalogDeferredObject,
  CatalogIndex,
  CatalogOpaqueObject,
  CatalogTable,
  CompleteIntrospectionCatalog,
  IntrospectionCatalog,
} from "./types.ts"

/**
 * Materialize every optional object-family collection and deeply freeze the normalized catalog.
 * Catalog text and extension data remain values; this helper never evaluates SQL or assigns
 * persisted logical identities.
 */
export function createCompleteIntrospectionCatalog(
  catalog: IntrospectionCatalog,
): CompleteIntrospectionCatalog {
  const complete: CompleteIntrospectionCatalog = {
    dialect: catalog.dialect,
    server: catalog.server,
    capabilities: catalog.capabilities ?? catalog.server.capabilities,
    namespace: catalog.namespace,
    tables: sortTables(catalog.tables),
    views: sortObjects(catalog.views ?? []),
    sequences: sortObjects(catalog.sequences ?? []),
    enums: sortObjects(catalog.enums ?? []),
    domains: sortObjects(catalog.domains ?? []),
    collations: sortObjects(catalog.collations ?? []),
    triggers: sortObjects(catalog.triggers ?? []),
    routines: sortObjects(catalog.routines ?? []),
    partitions: sortObjects(catalog.partitions ?? []),
    policies: sortObjects(catalog.policies ?? []),
    extensionObjects: sortObjects(catalog.extensionObjects ?? []),
    deferredObjects: [...catalog.deferredObjects].sort(compareDeferred),
    opaqueObjects: sortObjects(catalog.opaqueObjects ?? []),
    comments: [...(catalog.comments ?? [])].sort(compareId),
    ownership: [...(catalog.ownership ?? [])].sort(compareId),
    diagnostics: [...catalog.diagnostics],
  }

  return deepFreeze(complete)
}

/** Alias for callers that already use the normalized-catalog terminology. */
export const freezeIntrospectionCatalog = createCompleteIntrospectionCatalog

/** Convert a complete catalog back to the optional reader-facing contract. */
export function toIntrospectionCatalog(
  catalog: CompleteIntrospectionCatalog,
): IntrospectionCatalog {
  return deepFreeze({
    ...catalog,
    capabilities: catalog.capabilities,
  })
}

function sortTables(tables: readonly CatalogTable[]): readonly CatalogTable[] {
  return [...tables]
    .map((table) =>
      deepFreeze({
        ...table,
        columns: [...table.columns].sort(compareColumn),
        constraints: [...table.constraints].sort(compareId),
        indexes: [...table.indexes].sort(compareId),
      }),
    )
    .sort(compareId)
}

function sortObjects<T extends { readonly id: string }>(objects: readonly T[]): readonly T[] {
  return [...objects].sort(compareId)
}

function compareId(left: { readonly id: string }, right: { readonly id: string }): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
}

function compareDeferred(left: CatalogDeferredObject, right: CatalogDeferredObject): number {
  const leftId = left.id ?? left.physicalName
  const rightId = right.id ?? right.physicalName

  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0
}

function compareColumn(left: CatalogColumn, right: CatalogColumn): number {
  return left.ordinalPosition - right.ordinalPosition || compareId(left, right)
}

/**
 * Freeze nested catalog values without imposing JSON semantics on bigint or opaque driver values.
 * The normalized contract is expected to contain plain records, arrays, and scalar values;
 * unsupported prototypes are retained but still frozen so the operation remains non-destructive.
 */
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

/** Keep these imports visible to declaration consumers of the helper module. */
export type { CatalogConstraint, CatalogIndex, CatalogOpaqueObject }
