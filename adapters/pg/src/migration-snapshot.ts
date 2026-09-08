import type { MigrationSnapshot, MigrationSnapshotInspection } from "@qubu/migrate/executor"
import type { ClientBase } from "pg"
import { mapCatalogToSnapshot } from "qubu/introspection"
import type { CatalogObjectReference, IntrospectionCatalog } from "qubu/introspection"
import { readCatalog } from "qubu/introspection/postgres"

/**
 * Inspect one PostgreSQL namespace in strict mode (public when expected is absent). The expected
 * snapshot selects physical table names and preserves logical identities; it never supplies missing
 * catalog facts. Other namespace-level objects remain included. Objects owned by excluded tables
 * and reserved __qubu_migration_ objects are removed with their metadata. Unresolved relationships
 * and strict catalog failures throw.
 */
export async function readMigrationSnapshot(
  client: ClientBase,
  expected?: MigrationSnapshot,
): Promise<MigrationSnapshotInspection> {
  const options = {
    namespace: expected?.namespace.name ?? "public",
    mode: "strict" as const,
    ...(expected === undefined ? {} : { previousSnapshot: expected }),
  }
  const catalog = await readCatalog(
    {
      dialect: "postgresql",
      async query<TRow extends Readonly<Record<string, unknown>>>(statement: {
        readonly text: string
        readonly parameters: readonly unknown[]
      }): Promise<readonly TRow[]> {
        const result = await client.query<TRow>(statement.text, [...statement.parameters])

        return result.rows
      },
    },
    options,
  )
  const owned = (name: string): boolean => name.startsWith("__qubu_migration_")
  const names = expected && new Set(expected.tables.map((table) => table.physicalName))
  const excludedTables = catalog.tables.filter(
    (table) => owned(table.physicalName) || (names && !names.has(table.physicalName)),
  )
  const excludedTableNames = new Set(excludedTables.map((table) => table.physicalName))
  const excluded = new Set(excludedTables.map((table) => `table:${table.id}`))
  const excludesReference = (reference: CatalogObjectReference): boolean =>
    excluded.has(`${reference.kind}:${reference.id}`) ||
    (reference.owner !== undefined && excluded.has(`${reference.owner.kind}:${reference.owner.id}`))
  const unmanagedObjects = excludedTables
    .filter((table) => !owned(table.physicalName))
    .map((table) => ({
      kind: "table",
      physicalName: table.physicalName,
    }))

  function keep<
    T extends {
      readonly kind: string
      readonly id?: string
      readonly physicalName: string
    },
  >(
    objects: readonly T[] | undefined,
    attachedToExcludedTable: (object: T) => boolean = () => false,
  ): readonly T[] {
    return (objects ?? []).filter((object) => {
      if (owned(object.physicalName) || attachedToExcludedTable(object)) {
        excluded.add(`${object.kind}:${object.id}`)
        return false
      }

      return true
    })
  }

  const managed: IntrospectionCatalog = {
    ...catalog,
    tables: catalog.tables.filter((table) => !excludedTableNames.has(table.physicalName)),
    views: keep(catalog.views),
    sequences: keep(
      catalog.sequences,
      (sequence) => sequence.ownedBy !== undefined && excludesReference(sequence.ownedBy),
    ),
    enums: keep(catalog.enums),
    domains: keep(catalog.domains),
    collations: keep(catalog.collations),
    triggers: keep(catalog.triggers, (trigger) => excludesReference(trigger.table)),
    routines: keep(catalog.routines),
    partitions: keep(
      catalog.partitions,
      (partition) =>
        excludesReference(partition.parent) || excludedTableNames.has(partition.physicalName),
    ),
    policies: keep(catalog.policies, (policy) => excludesReference(policy.table)),
    extensionObjects: keep(catalog.extensionObjects),
    deferredObjects: keep(catalog.deferredObjects),
    opaqueObjects: keep(
      catalog.opaqueObjects,
      (object) =>
        typeof object.data === "object" &&
        object.data !== null &&
        !Array.isArray(object.data) &&
        "table" in object.data &&
        typeof object.data.table === "string" &&
        excludedTableNames.has(object.data.table),
    ),
  }
  const mapped = mapCatalogToSnapshot(
    {
      ...managed,
      comments: (catalog.comments ?? []).filter((item) => !excludesReference(item.object)),
      ownership: (catalog.ownership ?? []).filter((item) => !excludesReference(item.object)),
    },
    options,
  )

  if (!mapped.ok) {
    throw new Error(
      `Strict PostgreSQL introspection failed: ${mapped.diagnostics.map((item) => item.message).join("; ")}`,
    )
  }

  return Object.freeze({
    snapshot: mapped.snapshot,
    unmanagedObjects: Object.freeze(unmanagedObjects),
  })
}
