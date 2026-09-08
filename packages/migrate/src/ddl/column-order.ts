import type { SchemaSnapshot } from "qubu/snapshot"

import type { MigrationPlan } from "../plan/index.ts"

/** Physical ordering policy for newly created tables. Alignment is PostgreSQL-only. */
export type ColumnOrder = "declaration" | "alignment"

/** Validate an ordering policy supplied by typed or untyped callers. */
export function columnOrderError(value: unknown, dialect: string): string | undefined {
  if (value !== undefined && value !== "declaration" && value !== "alignment") {
    return 'columnOrder must be "declaration" or "alignment"'
  }

  if (value === "alignment" && dialect !== "postgresql") {
    return "Alignment column ordering is supported only for PostgreSQL"
  }
}

// Known fixed-width PostgreSQL types only. Unknown types and variable-length
// values stay after this group; their alignment cannot establish a fixed layout.
const fixedTypes: Readonly<Record<string, number>> = {
  boolean: 1,
  bool: 1,
  uuid: 1,
  smallint: 2,
  int2: 2,
  integer: 4,
  int: 4,
  int4: 4,
  real: 4,
  float4: 4,
  date: 4,
  bigint: 8,
  int8: 8,
  "double precision": 8,
  float8: 8,
  timestamp: 8,
  "timestamp without time zone": 8,
  timestamptz: 8,
  "timestamp with time zone": 8,
  time: 8,
  "time without time zone": 8,
}

/** Sort known fixed-width fields first, retaining input order for equal ranks. */
export function alignColumns<T extends { storage?: unknown }>(columns: T[]): T[] {
  const rank = (column: T): number => {
    const storage = column.storage

    if (
      !storage ||
      typeof storage !== "object" ||
      !("type" in storage) ||
      !("kind" in storage) ||
      (storage.kind !== "native" && storage.kind !== "portable") ||
      typeof storage.type !== "string"
    ) {
      return 0
    }

    // Portable types must use the same SQL mapping as the PostgreSQL emitter.
    if (
      storage.kind === "portable" &&
      !["integer", "boolean", "date", "timestamp", "uuid"].includes(storage.type)
    ) {
      return 0
    }

    const type = storage.type.trim().toLowerCase()

    return Object.hasOwn(fixedTypes, type) ? fixedTypes[type]! : 0
  }

  return [...columns].sort((left, right) => rank(right) - rank(left))
}

/** Preserve observed order for existing columns and assign creation-time table order. */
export function physicalSnapshot(
  before: SchemaSnapshot | undefined,
  after: SchemaSnapshot,
  order: ColumnOrder = "declaration",
  plan?: MigrationPlan,
  customOperationIds: readonly string[] = [],
): SchemaSnapshot {
  return {
    ...after,
    tables: after.tables.map((table) => {
      const previous = before?.tables.find((item) => item.id === table.id)
      const declared = [...table.columns].sort((a, b) => a.ordinalPosition - b.ordinalPosition)

      if (previous) {
        const ordinals = new Map(
          previous.columns.map((column) => [column.id, column.ordinalPosition]),
        )
        // ADD COLUMN appends in emitted operation order, independently of the
        // desired schema's declaration order. Preserve gaps left by dropped columns.
        let position = Math.max(0, ...previous.columns.map((column) => column.ordinalPosition))
        const added = plan?.operations.filter(
          (operation) =>
            operation.type === "add" &&
            operation.kind === "column" &&
            operation.status !== "skipped" &&
            operation.origin?.after?.parent?.id === table.id,
        )

        for (const operation of added ?? []) {
          if (operation.logicalId) {
            ordinals.set(operation.logicalId, ++position)
          }
        }

        for (const column of declared) {
          if (!ordinals.has(column.id)) {
            ordinals.set(column.id, ++position)
          }
        }

        // PostgreSQL retains attribute-number gaps after DROP COLUMN; MySQL
        // and SQLite report contiguous ordinals for the remaining columns.
        if (after.dialect.name !== "postgresql") {
          const remaining = [...table.columns].sort(
            (left, right) => ordinals.get(left.id)! - ordinals.get(right.id)!,
          )
          remaining.forEach((column, index) => ordinals.set(column.id, index + 1))
        }

        return {
          ...table,
          columns: table.columns.map((column) => ({
            ...column,
            ordinalPosition: ordinals.get(column.id) ?? column.ordinalPosition,
          })),
        }
      }

      const creation = plan?.operations.find(
        (operation) =>
          operation.type === "add" &&
          operation.kind === "table" &&
          operation.logicalId === table.id &&
          operation.status !== "skipped",
      )

      if (
        order === "declaration" ||
        (plan && (!creation || customOperationIds.includes(creation.id)))
      ) {
        return table
      }

      const ordered = alignColumns(declared)
      const positions = new Map(ordered.map((column, index) => [column.id, index + 1]))

      return {
        ...table,
        columns: table.columns.map((column) => ({
          ...column,
          ordinalPosition: positions.get(column.id)!,
        })),
      }
    }),
  }
}
