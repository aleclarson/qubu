import { assertDialectCapability } from "../../core/dialect.ts"
import {
  fragment,
  type CapabilityMetadataOf,
  type Fragment,
  type RenderContext,
  type RequiresCapabilityMeta,
  type RequiresOf,
  type RequiresOuterOf,
  type RequiresSourceMeta,
} from "../../core/fragment.ts"
import { identifier } from "../../core/primitives/identifier.ts"
import { createColumnReference } from "../../expressions/column.ts"
import { isExpression } from "../../expressions/types.ts"
import { columnResultValue, columnSqlType, encodeColumnParameter } from "../../schema/column.ts"
import type {
  SourceColumns,
  SourceIdentity,
  SourceRow,
  SourceSqlTypeMap,
} from "../../schema/source.ts"
import type { AnyTable } from "../../schema/table.ts"
import { queryValidationError, type QueryTypeValidation } from "../errors.ts"
import { omit } from "../omit.ts"
import type { UpdateAssignments } from "./update.ts"

/** Identity of the proposed row for one MySQL INSERT target. */
export type IncomingIdentity<TIdentity> = {
  readonly sourceKind: "mysql-incoming"
  readonly table: TIdentity
}
/** Typed proposed-row columns usable only in duplicate-key assignments. */
export type IncomingColumns<TTable extends AnyTable> = SourceColumns<
  SourceRow<TTable>,
  IncomingIdentity<SourceIdentity<TTable>>,
  SourceSqlTypeMap<TTable>
>

const assignmentTargets = new WeakMap<
  RenderContext,
  {
    table: AnyTable
    columns?: readonly string[]
  }
>()

export function renderDuplicateKeyUpdate(
  context: RenderContext,
  clause: OnDuplicateKeyUpdateClause<any, any>,
  columns?: readonly string[],
) {
  assignmentTargets.set(context, {
    table: clause.table,
    columns,
  })
  try {
    clause.render(context)
  } finally {
    assignmentTargets.delete(context)
  }
}

export function incomingAlias(table: AnyTable) {
  return table.tableName.toLowerCase() === "__qubu_incoming"
    ? "__qubu_incoming_row"
    : "__qubu_incoming"
}

/**
 * Reference the incoming row in MySQL duplicate-key assignments. INSERT SELECT exposes only its
 * explicit target columns; other references fail during rendering. These references cannot be used
 * as a FROM source.
 */
export function incoming<const TTable extends AnyTable>(table: TTable): IncomingColumns<TTable> {
  const reference = fragment((context) => {
    assertDialectCapability(context.dialect, "on-duplicate-key-update")
    if (assignmentTargets.get(context)?.table !== table) {
      throw invalid("Incoming columns require duplicate-key assignments for the same target table")
    }

    context.render(identifier(incomingAlias(table)))
  })

  return Object.freeze(
    Object.fromEntries(
      Object.keys(table.definitions).map((field) => [
        field,
        (() => {
          const column = createColumnReference(
            table.sqlNames[field] ?? field,
            reference,
            field,
            columnResultValue(table.definitions[field]),
          )

          return Object.freeze({
            ...column,
            render(context: RenderContext) {
              const scope = assignmentTargets.get(context)

              if (scope?.columns && !scope.columns.includes(field)) {
                throw invalid(`Incoming column "${field}" is not projected by INSERT SELECT`, field)
              }

              column.render(context)
            },
          })
        })(),
      ]),
    ),
  ) as IncomingColumns<TTable>
}

type AssignmentValidation<TTable extends AnyTable, TAssignments extends object> =
  TAssignments extends UpdateAssignments<TTable>
    ? Exclude<keyof TAssignments, keyof UpdateAssignments<TTable>> extends never
      ? Exclude<
          | RequiresOf<TAssignments[keyof TAssignments]>
          | RequiresOuterOf<TAssignments[keyof TAssignments]>,
          SourceIdentity<TTable> | IncomingIdentity<SourceIdentity<TTable>>
        > extends never
        ? unknown
        : QueryTypeValidation<
            "missing-source",
            "upsert.duplicate-key.assignments",
            "Use only the target table and its incoming row."
          >
      : QueryTypeValidation<
          "invalid-update",
          "upsert.duplicate-key.assignments",
          "Use only writable target columns."
        >
    : QueryTypeValidation<
        "invalid-update",
        "upsert.duplicate-key.assignments",
        "Provide target-compatible assignment values."
      >

/** MySQL INSERT clause; conflicts are determined by the database's keys. */
export interface OnDuplicateKeyUpdateClause<
  TTable extends AnyTable = AnyTable,
  TAssignments extends object = object,
> extends Fragment<
  | RequiresCapabilityMeta<"on-duplicate-key-update">
  | RequiresSourceMeta<SourceIdentity<TTable>>
  | CapabilityMetadataOf<TAssignments[keyof TAssignments]>
> {
  readonly clauseKind: "on-duplicate-key-update"
  readonly table: TTable
}

/**
 * Update writable columns when a MySQL INSERT row conflicts with a key. Raw values use target
 * column encoders. Expressions may reference the target table or incoming(table). At least one
 * non-omitted assignment is required.
 */
export function onDuplicateKeyUpdate<
  const TTable extends AnyTable,
  const TAssignments extends object,
>(
  table: TTable,
  assignments: TAssignments & AssignmentValidation<TTable, TAssignments>,
): OnDuplicateKeyUpdateClause<TTable, TAssignments> {
  const entries = Object.entries(assignments).filter(([, value]) => value !== omit)

  if (entries.length === 0) {
    throw invalid("Duplicate-key updates require at least one assignment")
  }

  for (const [field] of entries) {
    if (!Object.hasOwn(table.definitions, field) || table.definitions[field].generated) {
      throw invalid(`Column "${field}" is not a writable target column`, field)
    }
  }

  return Object.freeze({
    clauseKind: "on-duplicate-key-update" as const,
    table,
    render(context: RenderContext) {
      assertDialectCapability(context.dialect, "on-duplicate-key-update")
      const scope = assignmentTargets.get(context)

      if (scope?.table !== table) {
        throw invalid("Duplicate-key clauses require their matching INSERT target")
      }

      context.append("ON DUPLICATE KEY UPDATE ")
      const scoped: RenderContext = {
        ...context,
        render(part) {
          part.render(scoped)
        },
      }

      assignmentTargets.set(scoped, scope)
      try {
        entries.forEach(([field, value], index) => {
          if (index) {
            context.append(", ")
          }

          context.render(identifier(table.sqlNames[field] ?? field))
          context.append(" = ")
          if (isExpression(value)) {
            scoped.render(value)
          } else {
            context.parameter(
              encodeColumnParameter(table.definitions[field], value),
              columnSqlType(table.definitions[field]),
            )
          }
        })
      } finally {
        assignmentTargets.delete(scoped)
      }
    },
  }) as OnDuplicateKeyUpdateClause<TTable, TAssignments>
}

function invalid(message: string, field?: string) {
  return queryValidationError({
    code: "invalid-update",
    context: "upsert.duplicate-key.assignments",
    path: ["onDuplicateKeyUpdate", "assignments", ...(field ? [field] : [])],
    message,
    hint: "Use writable columns and incoming values from the INSERT target table.",
  })
}
