import { assertSchemaSnapshot } from "../snapshot/decode.ts"
import { sqliteStorageAffinity } from "../snapshot/sqlite.ts"
import type {
  SchemaSnapshot,
  SnapshotCheckConstraint,
  SnapshotColumn,
  SnapshotConstraint,
  SnapshotDefault,
  SnapshotDialectExtension,
  SnapshotExpression,
  SnapshotForeignKey,
  SnapshotGeneratedColumn,
  SnapshotIdentity,
  SnapshotIndex,
  SnapshotIndexTerm,
  SnapshotIndexTermExpression,
  SnapshotKeyConstraint,
  SnapshotLiteral,
  SnapshotStorage,
  SnapshotTable,
  SnapshotUniqueConstraint,
  SnapshotJsonValue,
} from "../snapshot/types.ts"
import { createIntrospectionDiagnostic, type IntrospectionDiagnostic } from "./diagnostics.ts"
import { introspectedPhysicalIdentityPolicy, type CatalogIdentityEntityKind } from "./identity.ts"
import type {
  CatalogColumn,
  CatalogConstraint,
  CatalogData,
  CatalogDialect,
  CatalogDialectExtension,
  CatalogGeneratedColumn,
  CatalogIdentity,
  CatalogIndex,
  CatalogIndexTerm,
  CatalogLiteralFact,
  CatalogSqlExpression,
  CatalogTable,
  CatalogValueFact,
  IntrospectionCatalog,
  IntrospectionFailure,
  IntrospectionMode,
  IntrospectionOptions,
  IntrospectionResult,
  IntrospectionSuccess,
} from "./types.ts"

/** Construct and validate a canonical Snapshot v1 from a normalized catalog. */
export function mapCatalogToSnapshot(
  catalog: IntrospectionCatalog,
  options: IntrospectionOptions,
): IntrospectionResult {
  const mode = options.mode ?? "strict"
  const diagnostics = [...catalog.diagnostics]
  const tables = catalog.tables
    .map((table) => mapTable(catalog, table, options, mode, diagnostics))
    .sort(compareById)
  const snapshot: SchemaSnapshot = {
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
    namespace: catalog.namespace.name,
    tables,
  }

  if (mode === "strict" && diagnostics.some(isError)) {
    return failure(catalog, diagnostics)
  }

  try {
    const value = assertSchemaSnapshot(snapshot)
    const lossy =
      mode === "lossy" && diagnostics.some((diagnostic) => diagnostic.severity === "warning")
    const result: IntrospectionSuccess = {
      ok: true,
      catalog,
      snapshot: value,
      diagnostics: Object.freeze(diagnostics),
      lossy,
    }

    return Object.freeze(result)
  } catch (error) {
    const severity = mode === "strict" ? "error" : "warning"

    diagnostics.push(
      createIntrospectionDiagnostic({
        severity,
        code: "invalid-catalog-row",
        message:
          error instanceof Error
            ? `Catalog facts could not form Snapshot v1: ${error.message}`
            : "Catalog facts could not form Snapshot v1",
        path: [],
        remediation: "Inspect the catalog diagnostics and unsupported features.",
      }),
    )
    return failure(catalog, diagnostics)
  }
}

function mapTable(
  catalog: IntrospectionCatalog,
  table: CatalogTable,
  options: IntrospectionOptions,
  mode: IntrospectionMode,
  diagnostics: IntrospectionDiagnostic[],
): SnapshotTable {
  const tableId = resolveId("table", table.id, table.physicalName, undefined, options)
  const columnIds = new Map(
    table.columns.map((column) => [
      column.physicalName,
      resolveId("column", column.id, column.physicalName, table.physicalName, options),
    ]),
  )
  const columns = [...table.columns]
    .sort((left, right) => left.ordinalPosition - right.ordinalPosition)
    .map((column) => mapColumn(catalog.dialect, table, column, options, diagnostics))
    .sort(compareById)
  const constraints = [...table.constraints]
    .map((constraint) =>
      mapConstraint(catalog, table, constraint, columnIds, options, mode, diagnostics),
    )
    .filter((value): value is SnapshotConstraint => value !== undefined)
    .sort(compareById)
  const indexes = [...table.indexes]
    .map((index) => mapIndex(table, index, columnIds, options, mode, diagnostics))
    .filter((value): value is SnapshotIndex => value !== undefined)
    .sort(compareById)

  return {
    id: tableId,
    physicalName: table.physicalName,
    columns,
    constraints,
    indexes,
  }
}

function mapColumn(
  dialect: CatalogDialect,
  table: CatalogTable,
  column: CatalogColumn,
  options: IntrospectionOptions,
  diagnostics: IntrospectionDiagnostic[],
): SnapshotColumn {
  const defaultValue = column.default ? mapDefault(column.default, column, diagnostics) : undefined
  const generated = column.generated
    ? mapGenerated(column.generated, column, options.mode ?? "strict", diagnostics)
    : undefined
  const identity = column.identity ? mapIdentity(column.identity, column, diagnostics) : undefined
  const storage: SnapshotStorage = {
    kind: "native",
    dialect,
    type: column.storage.nativeType,
    ...(dialect === "sqlite" ? { affinity: sqliteStorageAffinity(column.storage.nativeType) } : {}),
  }

  return {
    id: resolveId("column", column.id, column.physicalName, table.physicalName, options),
    physicalName: column.physicalName,
    nullable: column.nullable,
    hasDefault: defaultValue !== undefined,
    generated: generated !== undefined || identity !== undefined,
    storage,
    default: defaultValue,
    generatedColumn: generated,
    identity,
    onUpdate: column.onUpdate ? mapExpression(column.onUpdate) : undefined,
  }
}

function mapConstraint(
  catalog: IntrospectionCatalog,
  table: CatalogTable,
  constraint: CatalogConstraint,
  columnIds: ReadonlyMap<string, string>,
  options: IntrospectionOptions,
  mode: IntrospectionMode,
  diagnostics: IntrospectionDiagnostic[],
): SnapshotConstraint | undefined {
  const physicalName = constraint.physicalName ?? constraint.id
  const id = resolveId("constraint", constraint.id, physicalName, table.physicalName, options)

  if (constraint.kind === "check") {
    const result: SnapshotCheckConstraint = {
      id,
      kind: "check",
      physicalName,
      expression: mapExpression(constraint.expression),
      deferrable: constraint.deferrable,
      initially: constraint.initially,
      dialect: mapExtension(constraint.dialect),
    }

    return result
  }

  const columns = constraint.columns.map((column) => {
    const value = columnIds.get(column)

    if (value) {
      return value
    }

    addIssue(
      mode,
      diagnostics,
      "unresolved-reference",
      `Constraint column ${column} was not found`,
      constraint,
    )
    return column
  })

  if (constraint.kind === "primary-key") {
    const result: SnapshotKeyConstraint = {
      id,
      kind: "primary-key",
      physicalName,
      columns,
      deferrable: constraint.deferrable,
      initially: constraint.initially,
      dialect: mapExtension(constraint.dialect),
    }

    return result
  }

  if (constraint.kind === "unique") {
    const nullable = constraint.columns.some(
      (column) => table.columns.find((candidate) => candidate.physicalName === column)?.nullable,
    )

    if (nullable || constraint.nulls === "not-distinct") {
      const result: SnapshotUniqueConstraint = {
        id,
        kind: "unique-constraint",
        physicalName,
        columns,
        nulls: constraint.nulls,
        deferrable: constraint.deferrable,
        initially: constraint.initially,
        dialect: mapExtension(constraint.dialect),
      }

      return result
    }

    const result: SnapshotKeyConstraint = {
      id,
      kind: "unique",
      physicalName,
      columns,
      deferrable: constraint.deferrable,
      initially: constraint.initially,
      dialect: mapExtension(constraint.dialect),
    }

    return result
  }

  const targetTable = catalog.tables.find(
    (candidate) => candidate.physicalName === constraint.target.table,
  )

  if (!targetTable) {
    addIssue(
      mode,
      diagnostics,
      "unresolved-reference",
      `Foreign key target table ${constraint.target.table} was not found`,
      constraint,
    )
    return undefined
  }

  const targetId = resolveId("table", targetTable.id, targetTable.physicalName, undefined, options)
  const targetColumns = constraint.target.columns.map((column) => {
    const target = targetTable.columns.find((candidate) => candidate.physicalName === column)

    if (target) {
      return resolveId("column", target.id, target.physicalName, targetTable.physicalName, options)
    }

    addIssue(
      mode,
      diagnostics,
      "unresolved-reference",
      `Foreign key target column ${column} was not found`,
      constraint,
    )
    return column
  })
  const result: SnapshotForeignKey = {
    id,
    kind: "foreign-key",
    physicalName,
    columns,
    target: {
      table: targetId,
      columns: targetColumns,
    },
    onUpdate: constraint.onUpdate,
    onDelete: constraint.onDelete,
    match: constraint.match,
    deferrable: constraint.deferrable,
    initially: constraint.initially,
    dialect: mapExtension(constraint.dialect),
  }

  return result
}

function mapIndex(
  table: CatalogTable,
  index: CatalogIndex,
  columnIds: ReadonlyMap<string, string>,
  options: IntrospectionOptions,
  mode: IntrospectionMode,
  diagnostics: IntrospectionDiagnostic[],
): SnapshotIndex | undefined {
  const physicalName = index.physicalName ?? index.id
  const id = resolveId("index", index.id, physicalName, table.physicalName, options)
  const terms = [...index.terms]
    .sort((left, right) => left.position - right.position)
    .map((term) => mapIndexTerm(term, columnIds, index, mode, diagnostics))
    .filter((value): value is SnapshotIndexTerm => value !== undefined)
  const includedColumns = index.includedColumns?.map((column) => {
    const value = columnIds.get(column)

    if (value) {
      return value
    }

    addIssue(
      mode,
      diagnostics,
      "unresolved-reference",
      `Index column ${column} was not found`,
      index,
    )
    return column
  })
  const candidateKey =
    index.unique &&
    index.predicate === undefined &&
    index.terms.every(
      (term) =>
        term.kind === "column" &&
        table.columns.find((column) => column.physicalName === term.column)?.nullable === false,
    )

  return {
    id,
    kind: "index",
    physicalName,
    terms,
    unique: index.unique,
    candidateKey,
    predicate: index.predicate ? mapExpression(index.predicate) : undefined,
    includedColumns,
    dialect: mapExtension(index.dialect),
  }
}

function mapIndexTerm(
  term: CatalogIndexTerm,
  columnIds: ReadonlyMap<string, string>,
  index: CatalogIndex,
  mode: IntrospectionMode,
  diagnostics: IntrospectionDiagnostic[],
): SnapshotIndexTerm | undefined {
  let expression: SnapshotIndexTermExpression

  if (term.kind === "column") {
    const column = columnIds.get(term.column)

    if (!column) {
      addIssue(
        mode,
        diagnostics,
        "unresolved-reference",
        `Index column ${term.column} was not found`,
        index,
      )
      return undefined
    }

    expression = {
      kind: "column",
      column,
    }
    if (term.prefixLength !== undefined || term.operatorClass !== undefined) {
      addIssue(
        mode,
        diagnostics,
        "unsupported-feature",
        "Index term metadata is not represented by Snapshot v1",
        index,
      )
    }
  } else {
    expression = {
      kind: "expression",
      expression: mapExpression(term.expression),
    }
    if (term.operatorClass !== undefined) {
      addIssue(
        mode,
        diagnostics,
        "unsupported-feature",
        "Index operator classes are not represented by Snapshot v1",
        index,
      )
    }
  }

  if (term.direction === undefined && term.nulls === undefined) {
    return expression
  }

  return {
    kind: "order",
    expression,
    direction: term.direction,
    nulls: term.nulls,
  }
}

function mapDefault(
  value: CatalogValueFact,
  owner: CatalogColumn,
  diagnostics: IntrospectionDiagnostic[],
): SnapshotDefault {
  if (value.kind === "literal") {
    return {
      kind: "literal",
      value: mapLiteral(value),
    }
  }

  if (value.expression.text.trim().length === 0) {
    diagnostics.push(
      createIntrospectionDiagnostic({
        severity: "error",
        code: "invalid-catalog-row",
        message: "A default expression was empty",
        path: [owner.id, "default"],
        remediation: "Return the database expression or omit the default fact.",
      }),
    )
  }

  return {
    kind: "expression",
    expression: mapExpression(value.expression),
  }
}

function mapGenerated(
  value: CatalogGeneratedColumn,
  owner: CatalogColumn,
  mode: IntrospectionMode,
  diagnostics: IntrospectionDiagnostic[],
): SnapshotGeneratedColumn {
  if (value.mode === "unknown") {
    addIssue(
      mode,
      diagnostics,
      "unsupported-feature",
      "Generated-column storage mode was not recovered",
      owner,
    )
    return { kind: "external" }
  }

  return {
    kind: "expression",
    expression: mapExpression(value.expression),
    mode: value.mode,
  }
}

function mapIdentity(
  value: CatalogIdentity,
  owner: CatalogColumn,
  diagnostics: IntrospectionDiagnostic[],
): SnapshotIdentity {
  if (Object.keys(value.options).length > 0) {
    diagnostics.push(
      createIntrospectionDiagnostic({
        severity: "warning",
        code: "lossy-mapping",
        message: "Identity sequence options are not represented by Snapshot v1",
        path: [owner.id, "identity"],
        remediation: "Use the normalized catalog for options or add a typed dialect extension.",
      }),
    )
  }

  return {
    kind: "identity",
    generation: value.generation,
    dialect: mapExtension(value.dialect),
  }
}

function mapExpression(value: CatalogSqlExpression): SnapshotExpression {
  return {
    kind: "expression",
    // Catalog SQL has no Qubu expression semantics. Keep it explicitly unsafe
    // so the dialect tag remains valid at the Snapshot v1 boundary.
    expressionKind: "unsafe",
    sql: value.text.replace(/\r\n?/g, "\n").trim(),
    dialect: value.dialect,
  }
}

function mapLiteral(value: CatalogLiteralFact): SnapshotLiteral {
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

function mapExtension(
  value: CatalogDialectExtension | undefined,
): SnapshotDialectExtension | undefined {
  if (!value) {
    return undefined
  }

  return {
    dialect: value.dialect,
    version: value.version,
    data: toSnapshotData(value.data),
  }
}

function toSnapshotData(value: CatalogData): SnapshotJsonValue {
  if (typeof value === "bigint") {
    return { $bigint: value.toString() }
  }

  if (Array.isArray(value)) {
    return value.map(toSnapshotData)
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, toSnapshotData(child)]),
    )
  }

  return value
}

function resolveId(
  kind: CatalogIdentityEntityKind,
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

  if (hint) {
    return hint.logicalId
  }

  const previous = options.previousSnapshot

  if (previous) {
    const table = tablePhysicalName
      ? previous.tables.find((candidate) => candidate.physicalName === tablePhysicalName)
      : previous.tables.find((candidate) => candidate.physicalName === physicalName)

    if (kind === "table" && table) {
      return table.id
    }

    if (table && kind === "column") {
      const column = table.columns.find((candidate) => candidate.physicalName === physicalName)

      if (column) {
        return column.id
      }
    }

    if (table && kind === "constraint") {
      const constraint = table.constraints.find(
        (candidate) => candidate.physicalName === physicalName,
      )

      if (constraint) {
        return constraint.id
      }
    }

    if (table && kind === "index") {
      const index = table.indexes.find((candidate) => candidate.physicalName === physicalName)

      if (index) {
        return index.id
      }
    }
  }

  return currentId || physicalName
}

function addIssue(
  mode: IntrospectionMode,
  diagnostics: IntrospectionDiagnostic[],
  code: IntrospectionDiagnostic["code"],
  message: string,
  owner: { readonly id?: string },
): void {
  diagnostics.push(
    createIntrospectionDiagnostic({
      severity: mode === "strict" ? "error" : "warning",
      code,
      message,
      path: owner.id ? [owner.id] : [],
      remediation: "Use lossy mode or add a typed dialect mapping for this feature.",
    }),
  )
}

function failure(
  catalog: IntrospectionCatalog,
  diagnostics: readonly IntrospectionDiagnostic[],
): IntrospectionFailure {
  return Object.freeze({
    ok: false,
    catalog,
    diagnostics: Object.freeze([...diagnostics]),
    lossy: false,
  })
}

function compareById(left: { readonly id: string }, right: { readonly id: string }): number {
  return left.id.localeCompare(right.id)
}

function isError(value: IntrospectionDiagnostic): boolean {
  return value.severity === "error"
}
