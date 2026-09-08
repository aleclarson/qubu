import { MigrationExecutionError, type MigrationSnapshotInspection } from "@qubu/migrate/executor"
import {
  mapCatalogToSnapshot,
  type CatalogObjectReference,
  type IntrospectionCatalog,
} from "qubu/introspection"
import { readCatalog } from "qubu/introspection/mysql"
import { assertSchemaSnapshot, type SchemaSnapshot } from "qubu/snapshot"

import type { MigrationConnection } from "./migration-history.ts"

/**
 * Read the selected MySQL database in strict mode. Expected physical table names select managed
 * tables and preserve logical identities; expected facts never fill missing catalog facts. Other
 * namespace objects remain included. Reserved Qubu tables and metadata attached to excluded tables
 * are omitted. The selected database must match the expected namespace.
 */
export async function readMigrationSnapshot(
  connection: MigrationConnection,
  expected?: SchemaSnapshot,
  signal?: AbortSignal,
): Promise<MigrationSnapshotInspection> {
  const namespace = await selectedNamespace(connection, expected, signal)
  const options = {
    namespace,
    mode: "strict" as const,
    ...(signal === undefined ? {} : { signal }),
    ...(expected === undefined ? {} : { previousSnapshot: expected }),
  }
  const catalog = await readCatalog(
    {
      dialect: "mysql",
      async query<TRow extends Readonly<Record<string, unknown>>>(statement: {
        readonly text: string
        readonly parameters: readonly unknown[]
      }): Promise<readonly TRow[]> {
        signal?.throwIfAborted()
        const [rows] = await connection.execute({
          sql: statement.text,
          values: [...statement.parameters],
          rowsAsArray: false,
          nestTables: false,
        })

        if (
          !Array.isArray(rows) ||
          rows.some((row) => typeof row !== "object" || row === null || Array.isArray(row))
        ) {
          throw new TypeError("MySQL catalog queries must return object rows")
        }

        return rows as readonly TRow[]
      },
    },
    options,
  )

  signal?.throwIfAborted()
  const owned = (name: string): boolean =>
    name.startsWith("__qubu_migration_") || name === "__qubu_mysql2_migrations"
  const names = expected && new Set(expected.tables.map((table) => table.physicalName))
  const excludedTables = catalog.tables.filter(
    (table) => owned(table.physicalName) || (names && !names.has(table.physicalName)),
  )
  const excludedTableNames = new Set(excludedTables.map((table) => table.physicalName))
  const excluded = new Set(excludedTables.map((table) => `table:${table.id}`))
  const excludesReference = (reference: CatalogObjectReference): boolean =>
    excluded.has(`${reference.kind}:${reference.id}`) ||
    (reference.owner !== undefined && excluded.has(`${reference.owner.kind}:${reference.owner.id}`))

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
    routines: keep(catalog.routines),
    collations: keep(catalog.collations),
    triggers: keep(catalog.triggers, (trigger) => excludesReference(trigger.table)),
    partitions: keep(catalog.partitions, (partition) => excludesReference(partition.parent)),
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
    throw new MigrationExecutionError(
      "validation",
      "Strict MySQL introspection failed",
      {},
      {
        retry: "safe",
        details: mapped.diagnostics,
      },
    )
  }

  return {
    snapshot: mapped.snapshot,
    unmanagedObjects: excludedTables
      .filter((table) => !owned(table.physicalName))
      .map((table) => ({
        kind: "table",
        physicalName: table.physicalName,
      })),
  }
}

export async function selectedNamespace(
  connection: MigrationConnection,
  expected?: SchemaSnapshot,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted()
  if (expected !== undefined) {
    assertSchemaSnapshot(expected)
    if (expected.dialect.name !== "mysql" || expected.namespace.kind !== "mysql-database") {
      throw new MigrationExecutionError(
        "capability",
        "MySQL inspection requires a MySQL database scope",
      )
    }
  }

  const [databaseRows] = await connection.execute({
    sql: "SELECT DATABASE() AS namespace",
    values: [],
    rowsAsArray: false,
    nestTables: false,
  })
  const namespace = Array.isArray(databaseRows) ? databaseRows[0]?.namespace : undefined

  if (
    typeof namespace !== "string" ||
    !namespace ||
    (expected && namespace !== expected.namespace.name)
  ) {
    throw new MigrationExecutionError(
      "policy",
      "Select the same MySQL database as the inspection scope",
    )
  }

  signal?.throwIfAborted()
  return namespace
}
