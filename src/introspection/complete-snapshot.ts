import { toSnapshotJsonValue } from "../snapshot/canonical.ts"
import { hasCandidateKeyShape } from "../snapshot/candidate-key.ts"
import {
  assertCompleteSchemaSnapshot,
  type CompleteSchemaSnapshot,
  type CompleteSnapshotCheckConstraint,
  type CompleteSnapshotColumn,
  type CompleteSnapshotComment,
  type CompleteSnapshotConstraint,
  type CompleteSnapshotDeferredObject,
  type CompleteSnapshotDomain,
  type CompleteSnapshotEnum,
  type CompleteSnapshotExtension,
  type CompleteSnapshotIdentity,
  type CompleteSnapshotIndex,
  type CompleteSnapshotIndexTerm,
  type CompleteSnapshotObjectReference,
  type CompleteSnapshotObjectMetadata,
  type CompleteSnapshotOpaqueObject,
  type CompleteSnapshotOwnership,
  type CompleteSnapshotPartition,
  type CompleteSnapshotPolicy,
  type CompleteSnapshotRoutine,
  type CompleteSnapshotRoutineParameter,
  type CompleteSnapshotSequence,
  type CompleteSnapshotTable,
  type CompleteSnapshotTrigger,
  type CompleteSnapshotValueFact,
  type CompleteSnapshotView,
} from "../snapshot/index.ts"
import { storageAffinity } from "../snapshot/sqlite.ts"
import { createCompleteIntrospectionCatalog } from "./catalog.ts"
import { createIntrospectionDiagnostic, type IntrospectionDiagnostic } from "./diagnostics.ts"
import { introspectedPhysicalIdentityPolicy } from "./identity.ts"
import type {
  CatalogColumn,
  CatalogConstraint,
  CatalogDialectExtension,
  CatalogDomain,
  CatalogEnum,
  CatalogExtensionObject,
  CatalogIndex,
  CatalogLiteralFact,
  CatalogObjectReference,
  CatalogOpaqueObject,
  CatalogPartition,
  CatalogPolicy,
  CatalogProvenance,
  CatalogReference,
  CatalogRoutine,
  CatalogSequence,
  CatalogSqlExpression,
  CatalogTable,
  CatalogTrigger,
  CatalogUnknownField,
  CatalogValueFact,
  CatalogView,
  CompleteIntrospectionCatalog,
  IntrospectionCatalog,
  IntrospectionOptions,
} from "./types.ts"

/** Result returned by the strict normalized-catalog to Snapshot v1 mapper. */
export type CompleteSnapshotMappingResult =
  | {
      readonly ok: true
      readonly catalog: CompleteIntrospectionCatalog
      readonly snapshot: CompleteSchemaSnapshot
      readonly diagnostics: readonly IntrospectionDiagnostic[]
      readonly lossy: false
    }
  | {
      readonly ok: false
      readonly catalog: CompleteIntrospectionCatalog
      readonly diagnostics: readonly IntrospectionDiagnostic[]
      readonly lossy: false
    }

/**
 * Map a normalized catalog to strict Snapshot v1 data. Complete objects are never fabricated as
 * tables, and catalog references remain evidence rather than logical IDs.
 */
export function mapCatalogToCompleteSnapshot(
  input: IntrospectionCatalog,
  options?: IntrospectionOptions,
): CompleteSnapshotMappingResult {
  const catalog = createCompleteIntrospectionCatalog(applyIdentityOptions(input, options))
  const diagnostics = [...catalog.diagnostics]
  const tableByPhysicalName = new Map(catalog.tables.map((table) => [table.physicalName, table]))
  const tables = catalog.tables.map((table) =>
    mapTable(table, catalog.dialect, tableByPhysicalName, diagnostics),
  )
  const views = catalog.views.map((view) => mapView(view, catalog.dialect))
  const sequences = catalog.sequences.map((sequence) => mapSequence(sequence, catalog.dialect))
  const enums = catalog.enums.map((item) => mapEnum(item, catalog.dialect))
  const domains = catalog.domains.map((domain) => mapDomain(domain, catalog.dialect))
  const collations = catalog.collations.map((collation) => ({
    kind: "collation" as const,
    id: collation.id,
    physicalName: collation.physicalName,
    ...(collation.provider === undefined ? {} : { provider: collation.provider }),
    ...(collation.locale === undefined ? {} : { locale: collation.locale }),
    ...(collation.deterministic === undefined ? {} : { deterministic: collation.deterministic }),
    ...(collation.version === undefined ? {} : { version: collation.version }),
    ...mapMetadata(collation.provenance, collation.dialect, catalog.dialect, collation.reference),
  }))
  const triggers = catalog.triggers.map((trigger) =>
    mapTrigger(trigger, catalog.dialect, diagnostics),
  )
  const routines = catalog.routines.map((routine) => mapRoutine(routine, catalog.dialect))
  const partitions = catalog.partitions.map((partition) => mapPartition(partition, catalog.dialect))
  const policies = catalog.policies.map((policy) => mapPolicy(policy, catalog.dialect))
  const extensions = catalog.extensionObjects.map((extension) =>
    mapExtensionObject(extension, catalog.dialect),
  )
  const deferredObjects = catalog.deferredObjects.map((object) =>
    mapDeferredObject(object, catalog.dialect),
  )
  const opaqueObjects = catalog.opaqueObjects.map((object) =>
    mapOpaqueObject(object, catalog.dialect),
  )

  for (const object of catalogObjectsWithUnknownFields(catalog)) {
    for (const field of object.unknownFields ?? []) {
      opaqueObjects.push(mapUnknownField(object, field, catalog.dialect))
    }
  }

  const comments = (catalog.comments ?? []).map((comment) => mapComment(comment, catalog.dialect))
  const ownership = (catalog.ownership ?? []).map((item) => mapOwnership(item, catalog.dialect))

  // Keep direct metadata comments/owners visible even when a reader attached
  // them to an object instead of populating the catalog-level collections.
  for (const object of catalogObjectList(catalog)) {
    if (object.comment && !comments.some((item) => item.id === object.comment?.id)) {
      comments.push(mapComment(object.comment, catalog.dialect))
    }

    if (object.ownership && !ownership.some((item) => item.id === object.ownership?.id)) {
      ownership.push(mapOwnership(object.ownership, catalog.dialect))
    }
  }

  const snapshot: CompleteSchemaSnapshot = {
    format: "qubu-schema",
    version: 1,
    dialect: {
      name: catalog.dialect,
      version: 1,
    },
    namingPolicy: {
      name: introspectedPhysicalIdentityPolicy.name,
      version: introspectedPhysicalIdentityPolicy.version,
    },
    namespace: {
      kind: catalog.namespace.kind,
      name: catalog.namespace.name,
      ...mapMetadata(
        catalog.namespace.provenance,
        catalog.namespace.dialect,
        catalog.dialect,
        catalog.namespace.reference,
      ),
    },
    capabilities: catalog.capabilities,
    tables: tables.sort(compareId),
    views: views.sort(compareId),
    sequences: sequences.sort(compareId),
    enums: enums.sort(compareId),
    domains: domains.sort(compareId),
    collations: collations.sort(compareId),
    triggers: triggers.sort(compareId),
    routines: routines.sort(compareId),
    partitions: partitions.sort(compareId),
    policies: policies.sort(compareId),
    extensions: extensions.sort(compareId),
    deferredObjects: deferredObjects.sort(compareId),
    opaqueObjects: opaqueObjects.sort(compareId),
    comments: comments.sort(compareId),
    ownership: ownership.sort(compareId),
  }

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return Object.freeze({
      ok: false as const,
      catalog,
      diagnostics: Object.freeze(diagnostics),
      lossy: false as const,
    })
  }

  try {
    const value = assertCompleteSchemaSnapshot(snapshot)

    return Object.freeze({
      ok: true as const,
      catalog,
      snapshot: value,
      diagnostics: Object.freeze(diagnostics),
      lossy: false as const,
    })
  } catch (error) {
    diagnostics.push(
      createIntrospectionDiagnostic({
        severity: "error",
        code: "invalid-catalog-row",
        message:
          error instanceof Error
            ? `Catalog facts could not form Snapshot v1: ${error.message}`
            : "Catalog facts could not form Snapshot v1",
        path: [],
        remediation: "Inspect the catalog diagnostics and complete object mappings.",
      }),
    )
    return Object.freeze({
      ok: false as const,
      catalog,
      diagnostics: Object.freeze(diagnostics),
      lossy: false as const,
    })
  }
}

/** Numbered alias for callers that prefer the explicit Snapshot v1 mapper name. */
export const mapCatalogToSnapshotV1 = mapCatalogToCompleteSnapshot

function applyIdentityOptions(
  input: IntrospectionCatalog,
  options: IntrospectionOptions | undefined,
): IntrospectionCatalog {
  if (options?.identityHints === undefined && options?.previousSnapshot === undefined) {
    return input
  }

  const remappedTables = input.tables.map((table) => {
    const columnIds = new Map(
      table.columns.map((column) => [
        column.physicalName,
        resolveIdentity("column", column.id, column.physicalName, table.physicalName, options),
      ]),
    )
    const constraintIds = new Map(
      table.constraints.map((constraint) => {
        const physicalName = constraint.physicalName ?? constraint.id
        return [
          physicalName,
          resolveIdentity("constraint", constraint.id, physicalName, table.physicalName, options),
        ] as const
      }),
    )
    const indexIds = new Map(
      table.indexes.map((index) => {
        const physicalName = index.physicalName ?? index.id
        return [
          physicalName,
          resolveIdentity("index", index.id, physicalName, table.physicalName, options),
        ] as const
      }),
    )

    return {
      ...table,
      id: resolveIdentity("table", table.id, table.physicalName, undefined, options),
      columns: table.columns.map((column) => ({
        ...column,
        id: columnIds.get(column.physicalName) ?? column.id,
      })),
      constraints: table.constraints.map((constraint) => {
        const backingIndex =
          constraint.kind === "primary-key" || constraint.kind === "unique"
            ? constraint.backingIndex
            : undefined

        return {
          ...constraint,
          id: constraintIds.get(constraint.physicalName ?? constraint.id) ?? constraint.id,
          ...(constraint.kind === "foreign-key" ? { target: { ...constraint.target } } : {}),
          ...(backingIndex === undefined
            ? {}
            : {
                backingIndex: {
                  ...backingIndex,
                  id: indexIds.get(backingIndex.id) ?? backingIndex.id,
                },
              }),
        }
      }),
      indexes: table.indexes.map((index) => ({
        ...index,
        id: indexIds.get(index.physicalName ?? index.id) ?? index.id,
        ...(index.backingConstraint === undefined
          ? {}
          : {
              backingConstraint: {
                ...index.backingConstraint,
                id: constraintIds.get(index.backingConstraint.id) ?? index.backingConstraint.id,
              },
            }),
      })),
    }
  })

  return {
    ...input,
    tables: remappedTables,
  }
}

function resolveIdentity(
  kind: "table" | "column" | "constraint" | "index",
  currentId: string,
  physicalName: string,
  tablePhysicalName: string | undefined,
  options: IntrospectionOptions,
): string {
  const hint = options.identityHints?.find(
    (candidate) =>
      candidate.kind === kind &&
      candidate.physicalName === physicalName &&
      candidate.tablePhysicalName === tablePhysicalName,
  )

  if (hint !== undefined) {
    return hint.logicalId
  }

  const previous = options.previousSnapshot

  if (previous !== undefined) {
    const table = tablePhysicalName
      ? previous.tables.find((candidate) => candidate.physicalName === tablePhysicalName)
      : previous.tables.find((candidate) => candidate.physicalName === physicalName)

    if (kind === "table" && table !== undefined) {
      return table.id
    }

    if (table !== undefined && kind === "column") {
      return (
        table.columns.find((candidate) => candidate.physicalName === physicalName)?.id ?? currentId
      )
    }

    if (table !== undefined && kind === "constraint") {
      return (
        table.constraints.find((candidate) => candidate.physicalName === physicalName)?.id ??
        currentId
      )
    }

    if (table !== undefined && kind === "index") {
      return (
        table.indexes.find((candidate) => candidate.physicalName === physicalName)?.id ?? currentId
      )
    }
  }

  return currentId || physicalName
}

function mapTable(
  table: CatalogTable,
  dialect: string,
  tables: ReadonlyMap<string, CatalogTable>,
  diagnostics: IntrospectionDiagnostic[],
): CompleteSnapshotTable {
  const columns = table.columns.map((column) => mapColumn(column, dialect)).sort(compareId)
  const columnIds = new Map(table.columns.map((column) => [column.physicalName, column.id]))
  const columnNullability = new Map(
    table.columns.map((column) => [column.physicalName, column.nullable]),
  )
  const snapshotColumnNullability = new Map(
    table.columns.map((column) => [column.id, column.nullable]),
  )
  const constraints = table.constraints
    .map((constraint) =>
      mapConstraint(constraint, dialect, columnIds, columnNullability, tables, diagnostics),
    )
    .filter((value): value is CompleteSnapshotConstraint => value !== undefined)
    .sort(compareId)
  const indexes = table.indexes
    .map((index) => mapIndex(index, dialect, columnIds, snapshotColumnNullability))
    .sort(compareId)

  return {
    kind: "table",
    id: table.id,
    physicalName: table.physicalName,
    columns,
    constraints,
    indexes,
    ...mapMetadata(table.provenance, table.dialect, dialect, table.reference),
  }
}

function mapColumn(column: CatalogColumn, dialect: string): CompleteSnapshotColumn {
  const defaultValue = column.default ? mapValueFact(column.default) : undefined
  const generatedColumn = column.generated
    ? column.generated.mode === "unknown"
      ? ({ kind: "external" } as const)
      : {
          kind: "expression" as const,
          expression: mapExpression(column.generated.expression),
          mode: column.generated.mode,
        }
    : undefined
  const identity = column.identity ? mapIdentity(column.identity, dialect) : undefined

  return {
    kind: "column",
    id: column.id,
    physicalName: column.physicalName,
    ordinalPosition: column.ordinalPosition,
    nullable: column.nullable,
    hasDefault: defaultValue !== undefined,
    generated: generatedColumn !== undefined || identity !== undefined,
    storage: mapStorage(column.storage, dialect),
    ...(defaultValue === undefined ? {} : { default: defaultValue }),
    ...(generatedColumn === undefined ? {} : { generatedColumn }),
    ...(identity === undefined ? {} : { identity }),
    ...(column.onUpdate === undefined ? {} : { onUpdate: mapExpression(column.onUpdate) }),
    ...mapMetadata(column.provenance, column.dialect, dialect, column.reference),
  }
}

function mapConstraint(
  constraint: CatalogConstraint,
  dialect: string,
  columns: ReadonlyMap<string, string>,
  columnNullability: ReadonlyMap<string, boolean>,
  tables: ReadonlyMap<string, CatalogTable>,
  diagnostics: IntrospectionDiagnostic[],
): CompleteSnapshotConstraint | undefined {
  const physicalName = constraint.physicalName ?? constraint.id
  const common = {
    id: constraint.id,
    physicalName,
    ...mapMetadata(constraint.provenance, constraint.dialect, dialect, constraint.reference),
  }
  const mappedColumns =
    constraint.kind === "check"
      ? undefined
      : constraint.columns.map((column) => {
          const id = columns.get(column)

          if (id !== undefined) {
            return id
          }

          diagnostics.push(
            createIntrospectionDiagnostic({
              severity: "error",
              code: "unresolved-reference",
              message: `Constraint column ${column} was not found`,
              path: [constraint.id, "columns"],
            }),
          )
          return column
        })

  if (constraint.kind === "check") {
    return {
      kind: "check",
      ...common,
      expression: mapExpression(constraint.expression),
      ...(constraint.deferrable === undefined ? {} : { deferrable: constraint.deferrable }),
      ...(constraint.initially === undefined ? {} : { initially: constraint.initially }),
      ...(constraint.validated === undefined ? {} : { validated: constraint.validated }),
    }
  }

  if (constraint.kind === "primary-key") {
    return {
      kind: "primary-key",
      ...common,
      columns: mappedColumns ?? [],
      ...(constraint.backingIndex === undefined
        ? {}
        : { backingIndex: mapReference(constraint.backingIndex) }),
      ...(constraint.deferrable === undefined ? {} : { deferrable: constraint.deferrable }),
      ...(constraint.initially === undefined ? {} : { initially: constraint.initially }),
      ...(constraint.validated === undefined ? {} : { validated: constraint.validated }),
    }
  }

  if (constraint.kind === "unique") {
    const isNullable = constraint.columns.some((column) => columnNullability.get(column) === true)

    if (!isNullable && constraint.nulls === "distinct") {
      return {
        kind: "unique",
        ...common,
        columns: mappedColumns ?? [],
        ...(constraint.backingIndex === undefined
          ? {}
          : { backingIndex: mapReference(constraint.backingIndex) }),
        ...(constraint.deferrable === undefined ? {} : { deferrable: constraint.deferrable }),
        ...(constraint.initially === undefined ? {} : { initially: constraint.initially }),
        ...(constraint.validated === undefined ? {} : { validated: constraint.validated }),
      }
    }

    return {
      kind: "unique-constraint",
      ...common,
      columns: mappedColumns ?? [],
      nulls: constraint.nulls,
      ...(constraint.backingIndex === undefined
        ? {}
        : { backingIndex: mapReference(constraint.backingIndex) }),
      ...(constraint.deferrable === undefined ? {} : { deferrable: constraint.deferrable }),
      ...(constraint.initially === undefined ? {} : { initially: constraint.initially }),
      ...(constraint.validated === undefined ? {} : { validated: constraint.validated }),
    }
  }

  const targetTable = tables.get(constraint.target.table)
  const targetId = targetTable?.id

  if (targetId === undefined) {
    diagnostics.push(
      createIntrospectionDiagnostic({
        severity: "error",
        code: "unresolved-reference",
        message: `Foreign-key target table ${constraint.target.table} was not found`,
        path: [constraint.id, "target", "table"],
      }),
    )
  }

  const targetColumns = targetTable
    ? constraint.target.columns.map(
        (column) => targetTable.columns.find((item) => item.physicalName === column)?.id ?? column,
      )
    : constraint.target.columns

  return {
    kind: "foreign-key",
    ...common,
    columns: mappedColumns ?? [],
    target: {
      table: {
        kind: "table",
        id: targetId ?? constraint.target.table,
      },
      columns: targetColumns,
    },
    ...(constraint.onUpdate === undefined ? {} : { onUpdate: constraint.onUpdate }),
    ...(constraint.onDelete === undefined ? {} : { onDelete: constraint.onDelete }),
    ...(constraint.match === undefined ? {} : { match: constraint.match }),
    ...(constraint.deferrable === undefined ? {} : { deferrable: constraint.deferrable }),
    ...(constraint.initially === undefined ? {} : { initially: constraint.initially }),
    ...(constraint.validated === undefined ? {} : { validated: constraint.validated }),
  }
}

function mapIndex(
  index: CatalogIndex,
  dialect: string,
  columns: ReadonlyMap<string, string>,
  columnNullability: ReadonlyMap<string, boolean>,
): CompleteSnapshotIndex {
  const mapped: CompleteSnapshotIndex = {
    kind: "index",
    id: index.id,
    physicalName: index.physicalName ?? index.id,
    terms: index.terms
      .map((term) => mapIndexTerm(term, columns))
      .filter((term): term is CompleteSnapshotIndexTerm => term !== undefined)
      .sort((left, right) => left.position - right.position),
    unique: index.unique,
    candidateKey: false,
    ...(index.predicate === undefined ? {} : { predicate: mapExpression(index.predicate) }),
    ...(index.includedColumns === undefined
      ? {}
      : {
          includedColumns: index.includedColumns.map((column) => columns.get(column) ?? column),
        }),
    ...(index.backingConstraint === undefined
      ? {}
      : { backingConstraint: mapReference(index.backingConstraint) }),
    ...(index.method === undefined ? {} : { method: index.method }),
    ...mapMetadata(undefined, index.dialect, dialect, index.reference),
  }

  return {
    ...mapped,
    candidateKey: hasCandidateKeyShape(mapped, columnNullability),
  }
}

function mapIndexTerm(
  term: import("./types.ts").CatalogIndexTerm,
  columns: ReadonlyMap<string, string>,
): CompleteSnapshotIndexTerm | undefined {
  if (term.kind === "column") {
    const column = columns.get(term.column) ?? term.column

    return {
      kind: "column",
      column,
      position: term.position,
      ...(term.direction === undefined ? {} : { direction: term.direction }),
      ...(term.nulls === undefined ? {} : { nulls: term.nulls }),
      ...(term.prefixLength === undefined ? {} : { prefixLength: mapValueFact(term.prefixLength) }),
      ...(term.operatorClass === undefined ? {} : { operatorClass: term.operatorClass }),
    }
  }

  return {
    kind: "expression",
    expression: mapExpression(term.expression),
    position: term.position,
    ...(term.direction === undefined ? {} : { direction: term.direction }),
    ...(term.nulls === undefined ? {} : { nulls: term.nulls }),
    ...(term.operatorClass === undefined ? {} : { operatorClass: term.operatorClass }),
  }
}

function mapView(view: CatalogView, dialect: string): CompleteSnapshotView {
  return {
    kind: view.kind,
    id: view.id,
    physicalName: view.physicalName,
    columns: view.columns.map((column) => mapColumn(column, dialect)).sort(compareId),
    definition: mapExpression(view.definition),
    ...(view.dependencies === undefined
      ? {}
      : { dependencies: view.dependencies.map(mapReference) }),
    ...(view.checkOption === undefined ? {} : { checkOption: view.checkOption }),
    ...(view.securityBarrier === undefined ? {} : { securityBarrier: view.securityBarrier }),
    ...(view.securityInvoker === undefined ? {} : { securityInvoker: view.securityInvoker }),
    ...mapMetadata(view.provenance, view.dialect, dialect, view.reference),
  }
}

function mapSequence(sequence: CatalogSequence, dialect: string): CompleteSnapshotSequence {
  return {
    kind: "sequence",
    id: sequence.id,
    physicalName: sequence.physicalName,
    ...(sequence.storage === undefined ? {} : { storage: mapStorage(sequence.storage, dialect) }),
    ...(sequence.start === undefined ? {} : { start: mapValueFact(sequence.start) }),
    ...(sequence.increment === undefined ? {} : { increment: mapValueFact(sequence.increment) }),
    ...(sequence.minimum === undefined ? {} : { minimum: mapValueFact(sequence.minimum) }),
    ...(sequence.maximum === undefined ? {} : { maximum: mapValueFact(sequence.maximum) }),
    ...(sequence.cache === undefined ? {} : { cache: mapValueFact(sequence.cache) }),
    ...(sequence.cycle === undefined ? {} : { cycle: sequence.cycle }),
    ...(sequence.ownedBy === undefined ? {} : { ownedBy: mapReference(sequence.ownedBy) }),
    ...(sequence.identity === undefined
      ? {}
      : { identity: mapIdentity(sequence.identity, dialect) }),
    ...mapMetadata(sequence.provenance, sequence.dialect, dialect, sequence.reference),
  }
}

function mapEnum(item: CatalogEnum, dialect: string): CompleteSnapshotEnum {
  return {
    kind: "enum",
    id: item.id,
    physicalName: item.physicalName,
    values: [...item.values]
      .sort((left, right) => left.ordinalPosition - right.ordinalPosition)
      .map((value) => ({
        value: value.value,
        ordinalPosition: value.ordinalPosition,
        ...(value.provenance === undefined ? {} : { provenance: mapProvenance(value.provenance) }),
      })),
    ...mapMetadata(item.provenance, item.dialect, dialect, item.reference),
  }
}

function mapDomain(domain: CatalogDomain, dialect: string): CompleteSnapshotDomain {
  return {
    kind: "domain",
    id: domain.id,
    physicalName: domain.physicalName,
    storage: mapStorage(domain.storage, dialect),
    ...(domain.nullable === undefined ? {} : { nullable: domain.nullable }),
    ...(domain.default === undefined ? {} : { default: mapValueFact(domain.default) }),
    ...(domain.constraints === undefined
      ? {}
      : {
          constraints: domain.constraints
            .map((constraint) => mapCheckConstraint(constraint, dialect))
            .sort(compareId),
        }),
    ...mapMetadata(domain.provenance, domain.dialect, dialect, domain.reference),
  }
}

function mapCheckConstraint(
  constraint: import("./types.ts").CatalogCheckConstraint,
  dialect: string,
): CompleteSnapshotCheckConstraint {
  return {
    kind: "check",
    id: constraint.id,
    physicalName: constraint.physicalName ?? constraint.id,
    expression: mapExpression(constraint.expression),
    ...(constraint.deferrable === undefined ? {} : { deferrable: constraint.deferrable }),
    ...(constraint.initially === undefined ? {} : { initially: constraint.initially }),
    ...(constraint.validated === undefined ? {} : { validated: constraint.validated }),
    ...mapMetadata(constraint.provenance, constraint.dialect, dialect, constraint.reference),
  }
}

function mapTrigger(
  trigger: CatalogTrigger,
  dialect: string,
  _diagnostics: IntrospectionDiagnostic[],
): CompleteSnapshotTrigger {
  return {
    kind: "trigger",
    id: trigger.id,
    physicalName: trigger.physicalName,
    table: mapReference(trigger.table),
    timing: trigger.timing,
    events: [...trigger.events].sort(),
    ...(trigger.orientation === undefined ? {} : { orientation: trigger.orientation }),
    ...(trigger.condition === undefined ? {} : { condition: mapExpression(trigger.condition) }),
    body: mapExpression(trigger.body),
    ...(trigger.enabled === undefined ? {} : { enabled: trigger.enabled }),
    ...mapMetadata(trigger.provenance, trigger.dialect, dialect, trigger.reference),
  }
}

function mapRoutine(routine: CatalogRoutine, dialect: string): CompleteSnapshotRoutine {
  return {
    kind: "routine",
    id: routine.id,
    physicalName: routine.physicalName,
    routineKind: routine.routineKind,
    parameters: [...routine.parameters]
      .sort((left, right) => left.ordinalPosition - right.ordinalPosition)
      .map((parameter) => mapRoutineParameter(parameter, dialect)),
    ...(routine.returnType === undefined
      ? {}
      : { returnType: mapStorage(routine.returnType, dialect) }),
    ...(routine.language === undefined ? {} : { language: routine.language }),
    ...(routine.body === undefined ? {} : { body: mapExpression(routine.body) }),
    ...(routine.volatility === undefined ? {} : { volatility: routine.volatility }),
    ...(routine.parallel === undefined ? {} : { parallel: routine.parallel }),
    ...(routine.security === undefined ? {} : { security: routine.security }),
    ...(routine.dependencies === undefined
      ? {}
      : { dependencies: routine.dependencies.map(mapReference) }),
    ...mapMetadata(routine.provenance, routine.dialect, dialect, routine.reference),
  }
}

function mapRoutineParameter(
  parameter: import("./types.ts").CatalogRoutineParameter,
  dialect: string,
): CompleteSnapshotRoutineParameter {
  return {
    ...(parameter.name === undefined ? {} : { name: parameter.name }),
    ...(parameter.mode === undefined ? {} : { mode: parameter.mode }),
    storage: mapStorage(parameter.storage, dialect),
    ...(parameter.default === undefined ? {} : { default: mapValueFact(parameter.default) }),
    ordinalPosition: parameter.ordinalPosition,
  }
}

function mapPartition(partition: CatalogPartition, dialect: string): CompleteSnapshotPartition {
  return {
    kind: "partition",
    id: partition.id,
    physicalName: partition.physicalName,
    parent: mapReference(partition.parent),
    strategy: partition.strategy,
    ...(partition.keyColumns === undefined ? {} : { keyColumns: [...partition.keyColumns] }),
    ...(partition.bound === undefined ? {} : { bound: mapExpression(partition.bound) }),
    ...(partition.default === undefined ? {} : { default: partition.default }),
    ...mapMetadata(partition.provenance, partition.dialect, dialect, partition.reference),
  }
}

function mapPolicy(policy: CatalogPolicy, dialect: string): CompleteSnapshotPolicy {
  return {
    kind: "policy",
    id: policy.id,
    physicalName: policy.physicalName,
    table: mapReference(policy.table),
    command: policy.command,
    ...(policy.roles === undefined ? {} : { roles: [...policy.roles].sort() }),
    ...(policy.permissive === undefined ? {} : { permissive: policy.permissive }),
    ...(policy.using === undefined ? {} : { using: mapExpression(policy.using) }),
    ...(policy.check === undefined ? {} : { check: mapExpression(policy.check) }),
    ...mapMetadata(policy.provenance, policy.dialect, dialect, policy.reference),
  }
}

function mapExtensionObject(
  extension: CatalogExtensionObject,
  dialect: string,
): CompleteSnapshotExtension {
  return {
    kind: "extension",
    id: extension.id,
    physicalName: extension.physicalName,
    extensionName: extension.extensionName,
    ...(extension.extensionVersion === undefined
      ? {}
      : { extensionVersion: extension.extensionVersion }),
    ...(extension.schema === undefined ? {} : { schema: extension.schema }),
    data: toSnapshotJsonValue(extension.data),
    ...(extension.configuration === undefined
      ? {}
      : { configuration: toSnapshotJsonValue(extension.configuration) }),
    ...mapMetadata(extension.provenance, extension.dialect, dialect, extension.reference),
  }
}

function mapDeferredObject(
  object: import("./types.ts").CatalogDeferredObject,
  dialect: string,
): CompleteSnapshotDeferredObject {
  const data = object.unknownFields
    ? Object.fromEntries(
        object.unknownFields.map((field) => [
          field.name,
          toSnapshotJsonValue(isCatalogSqlExpression(field.value) ? field.value.text : field.value),
        ]),
      )
    : undefined

  return {
    kind: "deferred-object",
    id: object.id ?? `deferred:${object.objectKind}:${object.physicalName}`,
    objectKind: object.objectKind,
    physicalName: object.physicalName,
    ...(data === undefined ? {} : { data: toSnapshotJsonValue(data) }),
    ...mapMetadata(object.provenance, object.dialect, dialect, object.reference),
  }
}

function mapOpaqueObject(
  object: CatalogOpaqueObject,
  dialect: string,
): CompleteSnapshotOpaqueObject {
  return {
    kind: "opaque-object",
    id: object.id,
    objectKind: object.objectKind,
    physicalName: object.physicalName,
    data: toSnapshotJsonValue(object.data),
    ...(object.sql === undefined ? {} : { sql: mapExpression(object.sql) }),
    ...mapMetadata(object.provenance, object.dialect, dialect, object.reference),
  }
}

function mapComment(
  comment: import("./types.ts").CatalogComment,
  dialect: string,
): CompleteSnapshotComment {
  return {
    kind: "comment",
    id: comment.id,
    physicalName: comment.reference?.name ?? comment.id,
    object: mapReference(comment.object),
    text: comment.text,
    ...mapMetadata(comment.provenance, comment.dialect, dialect, comment.reference),
  }
}

function mapOwnership(
  ownership: import("./types.ts").CatalogOwnership,
  dialect: string,
): CompleteSnapshotOwnership {
  return {
    kind: "ownership",
    id: ownership.id,
    physicalName: ownership.reference?.name ?? ownership.id,
    object: mapReference(ownership.object),
    owner: ownership.owner,
    ...mapMetadata(ownership.provenance, ownership.dialect, dialect, ownership.reference),
  }
}

function mapStorage(
  storage: import("./types.ts").CatalogStorageType,
  dialect: string,
): import("../snapshot/types.ts").SnapshotStorage {
  return {
    kind: "native",
    dialect,
    type: storage.nativeType,
    ...(dialect === "sqlite" ? { affinity: storageAffinity(storage.nativeType) } : {}),
  }
}

function mapValueFact(value: CatalogValueFact): CompleteSnapshotValueFact {
  if (value.kind === "literal") {
    return {
      kind: "literal",
      value: mapLiteral(value),
    }
  }

  return {
    kind: "expression",
    expression: mapExpression(value.expression),
  }
}

function mapLiteral(value: CatalogLiteralFact): import("../snapshot/types.ts").SnapshotLiteral {
  if (value.value === null) {
    return { kind: "null" }
  }

  if (typeof value.value === "boolean") {
    return {
      kind: "boolean",
      value: value.value,
    }
  }

  if (typeof value.value === "bigint") {
    return {
      kind: "bigint",
      value: value.value.toString(),
    }
  }

  if (typeof value.value === "number") {
    return {
      kind: "number",
      value: String(value.value),
    }
  }

  return {
    kind: "string",
    value: value.value,
  }
}

function mapIdentity(
  identity: import("./types.ts").CatalogIdentity,
  dialect: string,
): CompleteSnapshotIdentity {
  return {
    kind: "identity",
    generation: identity.generation,
    options: Object.fromEntries(
      Object.entries(identity.options).map(([key, value]) => [key, mapValueFact(value)]),
    ),
    ...mapMetadata(undefined, identity.dialect, dialect),
  }
}

function mapExpression(value: CatalogSqlExpression) {
  return {
    kind: "expression" as const,
    expressionKind: "unsafe",
    sql: value.text.replace(/\r\n?/g, "\n").trim(),
    dialect: value.dialect,
  }
}

function mapMetadata(
  provenance: CatalogProvenance | undefined,
  extension: CatalogDialectExtension | undefined,
  dialect: string,
  reference?: CatalogReference,
): CompleteSnapshotObjectMetadata {
  const mappedProvenance = provenance ? mapProvenance(provenance) : undefined
  const mappedExtension = extension
    ? {
        dialect: extension.dialect,
        version: extension.version,
        data: toSnapshotJsonValue(extension.data),
      }
    : undefined
  const physicalReference = reference
    ? {
        kind: reference.kind as import("../snapshot/complete-types.ts").CompleteSnapshotObjectKind,
        ...(reference.namespace === undefined ? {} : { namespace: reference.namespace }),
        ...(reference.table === undefined ? {} : { table: reference.table }),
        name: reference.name,
      }
    : undefined

  // Catalog objects may carry no provenance but their opaque extension must
  // still remain explicitly tagged. Do not synthesize a dialect extension.
  void dialect
  return {
    ...(mappedProvenance === undefined ? {} : { provenance: mappedProvenance }),
    ...(physicalReference === undefined ? {} : { physicalReference }),
    ...(mappedExtension === undefined ? {} : { dialect: mappedExtension }),
  }
}

function mapProvenance(value: CatalogProvenance) {
  return {
    kind: value.kind,
    dialect: value.dialect,
    ...(value.path === undefined ? {} : { path: [...value.path] }),
  }
}

function mapReference(reference: CatalogObjectReference): CompleteSnapshotObjectReference {
  return {
    kind: reference.kind as CompleteSnapshotObjectReference["kind"],
    id: reference.id,
  }
}

function catalogObjectList(catalog: CompleteIntrospectionCatalog): readonly {
  readonly kind: string
  readonly id?: string
  readonly physicalName?: string
  readonly comment?: import("./types.ts").CatalogComment
  readonly ownership?: import("./types.ts").CatalogOwnership
  readonly unknownFields?: readonly CatalogUnknownField[]
}[] {
  const topLevel = [
    catalog.namespace,
    ...catalog.tables,
    ...catalog.views,
    ...catalog.sequences,
    ...catalog.enums,
    ...catalog.domains,
    ...catalog.collations,
    ...catalog.triggers,
    ...catalog.routines,
    ...catalog.partitions,
    ...catalog.policies,
    ...catalog.extensionObjects,
    ...catalog.deferredObjects,
    ...catalog.opaqueObjects,
    ...catalog.comments,
    ...catalog.ownership,
  ]
  const nested = [
    ...catalog.tables.flatMap((table) => [
      ...table.columns,
      ...table.constraints,
      ...table.indexes,
    ]),
    ...catalog.views.flatMap((view) => view.columns),
    ...catalog.domains.flatMap((domain) => domain.constraints ?? []),
  ]

  return [...topLevel, ...nested]
}

function catalogObjectsWithUnknownFields(catalog: CompleteIntrospectionCatalog): readonly {
  readonly kind: string
  readonly id?: string
  readonly physicalName?: string
  readonly unknownFields?: readonly CatalogUnknownField[]
}[] {
  return catalogObjectList(catalog)
}

function mapUnknownField(
  object: {
    readonly kind: string
    readonly id?: string
    readonly physicalName?: string
  },
  field: CatalogUnknownField,
  dialect: string,
): CompleteSnapshotOpaqueObject {
  const sql = isCatalogSqlExpression(field.value) ? mapExpression(field.value) : undefined
  const value = isCatalogSqlExpression(field.value) ? field.value.text : field.value

  return {
    kind: "opaque-object",
    id: `unknown:${object.kind}:${object.id ?? object.physicalName ?? "object"}:${field.name}`,
    objectKind: "unknown-field",
    physicalName: object.physicalName ?? object.id ?? field.name,
    data: toSnapshotJsonValue({
      ownerKind: object.kind,
      ownerId: object.id ?? object.physicalName ?? field.name,
      field: field.name,
      value,
    }),
    ...(sql === undefined ? {} : { sql }),
    ...mapMetadata(field.provenance, undefined, dialect),
  }
}

function compareId(left: { readonly id: string }, right: { readonly id: string }): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
}

function isCatalogSqlExpression(value: unknown): value is CatalogSqlExpression {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as { readonly kind?: unknown }).kind === "sql" &&
    typeof (value as { readonly text?: unknown }).text === "string"
  )
}
