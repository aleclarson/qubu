import { mapCatalogToSnapshot } from "../introspection/snapshot.ts"
import {
  candidateKeyIndexColumns,
  hasCandidateKeyShape,
  isCandidateKeyIndex,
} from "../snapshot/candidate-key.ts"
import type {
  CatalogColumn,
  CatalogDialect,
  IntrospectionCatalog,
  IntrospectionResult,
} from "../introspection/types.ts"
import { decodeSchemaSnapshot } from "../snapshot/decode.ts"
import type {
  SchemaSnapshot,
  SnapshotConstraint,
  SnapshotIndex,
  SnapshotIndexTerm,
  SnapshotTable,
} from "../snapshot/types.ts"
import type { ResolvedColumn, ResolvedSchema, ResolvedTable } from "./model.ts"
import { printSchemaSource } from "./source.ts"
import type {
  CodegenApplicationType,
  CodegenColumnMapping,
  CodegenDiagnostic,
  CodegenNameContext,
  CodegenSqlDomain,
  SchemaCodegenOptions,
  SchemaCodegenResult,
} from "./types.ts"

const supportedDialects = new Set<CatalogDialect>(["postgresql", "sqlite", "mysql"])

const applicationTypes = new Set<CodegenApplicationType>([
  "unknown",
  "string",
  "number",
  "boolean",
  "bigint",
  "Date",
  "Uint8Array",
])

const sqlDomains = new Set<CodegenSqlDomain>([
  "unknown",
  "integer",
  "decimal",
  "text",
  "boolean",
  "date",
  "timestamp",
  "uuid",
  "json",
  "bigint",
  "binary",
])

const orderableDomains = new Set<CodegenSqlDomain>([
  "unknown",
  "integer",
  "decimal",
  "text",
  "date",
  "timestamp",
  "bigint",
])

const reservedBindings = new Set([
  "arguments",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "eval",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "implements",
  "import",
  "in",
  "interface",
  "instanceof",
  "let",
  "new",
  "null",
  "package",
  "private",
  "protected",
  "public",
  "return",
  "static",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
])

const unsupportedSnapshotFamilies = [
  ["views", "views"],
  ["sequences", "sequences"],
  ["enums", "enums"],
  ["domains", "domains"],
  ["collations", "collations"],
  ["triggers", "triggers"],
  ["routines", "routines"],
  ["partitions", "partitions"],
  ["policies", "policies"],
  ["extensions", "extensions"],
  ["deferredObjects", "deferred objects"],
  ["opaqueObjects", "opaque objects"],
  ["comments", "comments"],
  ["ownership", "ownership records"],
] as const

/**
 * Generate a deterministic TypeScript module from one introspection result.
 *
 * @remarks
 *   Generation accepts only a successful, non-lossy Snapshot v1 result for one PostgreSQL, SQLite,
 *   or MySQL namespace. It is pure: it opens no connection, performs no filesystem writes, and
 *   never evaluates catalog SQL. Existing introspection diagnostics are copied into the result. Any
 *   error returns no source. The generated module exports every ordinary table plus one schema
 *   registry. Physical names and native declarations remain escaped string literals. Catalog
 *   expressions use dialect-tagged schema data, checks use `catalogCheck()`, and foreign keys use
 *   lazy `catalogForeignKey()` targets. Foreign keys must have equal local and target arity and
 *   target an exact primary key, strict unique key, or candidate index. Nullable database UNIQUE
 *   constraints and indexes with lossy candidate-key facts do not provide that proof. Application output,
 *   insert, and update types default independently to `unknown`. The generator may attach a
 *   conservative SQL semantic domain, and {@link SchemaCodegenOptions.mapColumn} can override either
 *   type axis with a fixed token. Naming callbacks can replace suggested camelCase IDs, but they
 *   cannot supply source syntax.
 * @param input A completed introspection operation. Failed and lossy results are reported as
 *   diagnostics rather than thrown errors.
 * @param options Controlled logical-name and column-type mappings.
 * @returns Generated source and diagnostics, or diagnostics without source.
 */
export function generateSchemaSource(
  input: IntrospectionResult,
  options: SchemaCodegenOptions = {},
): SchemaCodegenResult {
  const diagnostics: CodegenDiagnostic[] = []

  try {
    if (!isOptions(options)) {
      diagnostics.push(
        errorDiagnostic("invalid-option", "Code generation options must be an object", ["options"]),
      )
      return failure(diagnostics)
    }

    if (!isIntrospectionResult(input)) {
      diagnostics.push(
        errorDiagnostic("invalid-input", "Code generation requires an introspection result", []),
      )
      return failure(diagnostics)
    }

    if (!validateOptions(options, diagnostics)) {
      return failure(diagnostics)
    }

    diagnostics.push(...input.diagnostics)

    if (!input.ok) {
      diagnostics.push(
        errorDiagnostic(
          "invalid-input",
          "Code generation requires a successful introspection result",
          [],
        ),
      )
      return failure(diagnostics)
    }

    if (input.lossy) {
      diagnostics.push(
        errorDiagnostic(
          "lossy-input",
          "Code generation rejects lossy introspection results",
          ["lossy"],
          "Run introspection in strict mode and resolve every reported omission.",
        ),
      )
    }

    if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
      return failure(diagnostics)
    }

    const decoded = decodeSchemaSnapshot(input.snapshot)

    if (!decoded.ok) {
      diagnostics.push(
        ...decoded.diagnostics.map((diagnostic) =>
          errorDiagnostic("unsupported-snapshot", diagnostic.message, diagnostic.path),
        ),
      )
      return failure(diagnostics)
    }

    const snapshot = decoded.value

    appendUnsupportedSnapshotFamilyDiagnostics(snapshot, diagnostics)

    if (hasErrors(diagnostics)) {
      return failure(diagnostics)
    }

    validateInputEnvelope(input.catalog, snapshot, diagnostics)
    validatePhysicalFacts(input.catalog, snapshot, diagnostics)
    validateSchemaProofs(snapshot, diagnostics)
    if (hasErrors(diagnostics)) {
      return failure(diagnostics)
    }

    const resolved = resolveSchema(input.catalog, snapshot, options, diagnostics)

    if (resolved === undefined || hasErrors(diagnostics)) {
      return failure(diagnostics)
    }

    validateResolvedDomains(resolved, diagnostics)
    if (hasErrors(diagnostics)) {
      return failure(diagnostics)
    }

    const source = printSchemaSource(resolved, diagnostics)

    if (source === undefined || hasErrors(diagnostics)) {
      return failure(diagnostics)
    }

    return Object.freeze({
      ok: true as const,
      source,
      diagnostics: freezeDiagnostics(diagnostics),
    })
  } catch (caught) {
    diagnostics.push(
      errorDiagnostic(
        "unsafe-source",
        caught instanceof Error
          ? `Schema source generation failed safely: ${caught.message}`
          : "Schema source generation failed safely",
        [],
      ),
    )
    return failure(diagnostics)
  }
}

function validateInputEnvelope(
  catalog: IntrospectionCatalog,
  snapshot: SchemaSnapshot,
  diagnostics: CodegenDiagnostic[],
): void {
  if (!supportedDialects.has(catalog.dialect)) {
    diagnostics.push(
      errorDiagnostic(
        "unsupported-snapshot",
        `Code generation does not support catalog dialect "${catalog.dialect}"`,
        ["catalog", "dialect"],
      ),
    )
  }

  if (snapshot.dialect.name !== catalog.dialect) {
    diagnostics.push(
      errorDiagnostic(
        "unsupported-snapshot",
        `Snapshot dialect "${snapshot.dialect.name}" does not match catalog dialect "${catalog.dialect}"`,
        ["snapshot", "dialect"],
        undefined,
        [["catalog", "dialect"]],
      ),
    )
  }

  if (snapshot.dialect.version !== 1) {
    diagnostics.push(
      errorDiagnostic(
        "unsupported-snapshot",
        `Code generation supports Snapshot v1 dialect extensions, received version ${snapshot.dialect.version}`,
        ["snapshot", "dialect", "version"],
      ),
    )
  }

  if (snapshot.namespace.name !== catalog.namespace.name) {
    diagnostics.push(
      errorDiagnostic(
        "unsupported-snapshot",
        "Snapshot and catalog namespaces do not match",
        ["snapshot", "namespace"],
        undefined,
        [["catalog", "namespace", "name"]],
      ),
    )
  }
}

function validatePhysicalFacts(
  catalog: IntrospectionCatalog,
  snapshot: SchemaSnapshot,
  diagnostics: CodegenDiagnostic[],
): void {
  const remapped = mapCatalogToSnapshot(catalog, {
    namespace: catalog.namespace.name,
    mode: "strict",
  })

  if (!remapped.ok) {
    diagnostics.push(
      errorDiagnostic(
        "omitted-fact",
        "The normalized catalog cannot be mapped to a complete strict Snapshot v1",
        ["catalog", "tables"],
        "Resolve the strict introspection diagnostics before generating source.",
      ),
    )
    return
  }

  const expected = JSON.stringify(toPhysicalFacts(remapped.snapshot))
  const actual = JSON.stringify(toPhysicalFacts(snapshot))

  if (actual !== expected) {
    diagnostics.push(
      errorDiagnostic(
        "omitted-fact",
        "The introspection snapshot does not contain the catalog's complete Snapshot v1 table facts",
        ["snapshot", "tables"],
        "Use the snapshot returned with this exact strict catalog result.",
      ),
    )
  }
}

function validateSchemaProofs(snapshot: SchemaSnapshot, diagnostics: CodegenDiagnostic[]): void {
  const tables = new Map(snapshot.tables.map((table) => [table.id, table]))

  for (const table of snapshot.tables) {
    const columns = new Map(table.columns.map((column) => [column.id, column]))
    const path = ["snapshot", "tables", table.id] as const

    for (const constraint of table.constraints) {
      if (constraint.kind !== "primary-key" && constraint.kind !== "unique") {
        continue
      }

      const nullable = constraint.columns.filter((column) => columns.get(column)?.nullable === true)

      if (nullable.length > 0) {
        diagnostics.push(
          errorDiagnostic(
            "unrepresentable-fact",
            `Strict key constraint "${constraint.physicalName}" contains nullable columns`,
            [...path, "constraints", constraint.id, "columns"],
            "Qubu primary and strict unique keys require every column to be non-nullable.",
          ),
        )
      }
    }

    for (const index of table.indexes) {
      if (!index.candidateKey) {
        continue
      }

      if (!hasCandidateKeyShape(index, columns)) {
        diagnostics.push(
          errorDiagnostic(
            "unrepresentable-fact",
            `Index "${index.physicalName}" is marked as a candidate key without an exact non-null column key`,
            [...path, "indexes", index.id, "candidateKey"],
          ),
        )
      }
    }

    for (const constraint of table.constraints) {
      if (constraint.kind !== "foreign-key") {
        continue
      }

      const constraintPath = [...path, "constraints", constraint.id] as const

      if (constraint.columns.length !== constraint.target.columns.length) {
        diagnostics.push(
          errorDiagnostic(
            "unrepresentable-fact",
            `Foreign key "${constraint.physicalName}" has unequal local and target arity`,
            [...constraintPath, "target", "columns"],
          ),
        )
        continue
      }

      const target = tables.get(constraint.target.table.id)

      if (target === undefined) {
        continue
      }

      if (!hasCandidateKey(target, constraint.target.columns)) {
        diagnostics.push(
          errorDiagnostic(
            "unrepresentable-fact",
            `Foreign key "${constraint.physicalName}" does not target an exact primary key, strict unique key, or candidate index`,
            [...constraintPath, "target", "columns"],
            "Nullable UNIQUE constraints are database uniqueness metadata, not Qubu candidate-key proofs.",
          ),
        )
      }
    }
  }
}

function hasCandidateKey(table: SnapshotTable, targetColumns: readonly string[]): boolean {
  const columns = new Map(table.columns.map((column) => [column.id, column]))
  const constraintMatch = table.constraints.some(
    (constraint) =>
      (constraint.kind === "primary-key" || constraint.kind === "unique") &&
      constraint.columns.every((column) => columns.get(column)?.nullable === false) &&
      sameColumns(constraint.columns, targetColumns),
  )

  if (constraintMatch) {
    return true
  }

  return table.indexes.some((index) => {
    if (!isCandidateKeyIndex(index, columns)) {
      return false
    }

    const candidateColumns = candidateKeyIndexColumns(index)

    return candidateColumns !== undefined && sameColumns(candidateColumns, targetColumns)
  })
}

function sameColumns(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((column, index) => column === right[index])
}

function resolveSchema(
  catalog: IntrospectionCatalog,
  snapshot: SchemaSnapshot,
  options: SchemaCodegenOptions,
  diagnostics: CodegenDiagnostic[],
): ResolvedSchema | undefined {
  const schemaSuggested = `${camelCase(catalog.namespace.name)}Schema`
  const schemaName = resolveName(
    {
      kind: "schema",
      physicalName: catalog.namespace.name,
      suggestedName: schemaSuggested,
    },
    options,
    ["schema"],
    true,
    diagnostics,
  )

  const catalogTables = groupUnique(
    catalog.tables,
    (table) => table.physicalName,
    ["catalog", "tables"],
    diagnostics,
  )
  const tables: ResolvedTable[] = []
  const tableNames = new Map<string, readonly (string | number)[]>()

  for (const table of [...snapshot.tables].sort(comparePhysicalName)) {
    const catalogTable = catalogTables.get(table.physicalName)

    if (catalogTable === undefined) {
      diagnostics.push(
        errorDiagnostic(
          "omitted-fact",
          `Snapshot table "${table.physicalName}" is missing from the catalog`,
          ["snapshot", "tables", table.id],
        ),
      )
      continue
    }

    const path = ["snapshot", "tables", table.id] as const
    const name = resolveName(
      {
        kind: "table",
        physicalName: table.physicalName,
        suggestedName: camelCase(table.physicalName),
      },
      options,
      path,
      true,
      diagnostics,
    )

    if (name === undefined) {
      continue
    }

    addUniqueName(name, path, tableNames, diagnostics)
    const resolvedTable = resolveTable(table, catalogTable, name, catalog, options, diagnostics)

    if (resolvedTable !== undefined) {
      tables.push(resolvedTable)
    }
  }

  if (schemaName !== undefined) {
    const tableCollision = tableNames.get(schemaName)

    if (tableCollision !== undefined) {
      diagnostics.push(
        errorDiagnostic(
          "name-collision",
          `Schema export and table export both resolve to "${schemaName}"`,
          ["schema"],
          undefined,
          [tableCollision],
        ),
      )
    }
  }

  if (schemaName === undefined || hasErrors(diagnostics)) {
    return undefined
  }

  const orderedTables = tables.sort(compareName)

  return {
    name: schemaName,
    namespace: catalog.namespace.name,
    dialect: catalog.dialect,
    tables: orderedTables,
    tablesBySnapshotId: new Map(orderedTables.map((table) => [table.snapshot.id, table])),
  }
}

function resolveTable(
  snapshot: SnapshotTable,
  catalogTable: IntrospectionCatalog["tables"][number],
  tableName: string,
  catalog: IntrospectionCatalog,
  options: SchemaCodegenOptions,
  diagnostics: CodegenDiagnostic[],
): ResolvedTable | undefined {
  const columnCatalog = groupUnique(
    catalogTable.columns,
    (column) => column.physicalName,
    ["catalog", "tables", catalogTable.id, "columns"],
    diagnostics,
  )
  const columns: ResolvedColumn[] = []
  const columnNames = new Map<string, readonly (string | number)[]>()

  // Generated source is serialized back in declaration order, which becomes Snapshot ordinal
  // positions; keep physical order here so a generated schema can round-trip without false diffs.
  for (const column of [...snapshot.columns].sort(comparePhysicalPosition)) {
    const path = ["snapshot", "tables", snapshot.id, "columns", column.id] as const
    const catalogColumn = columnCatalog.get(column.physicalName)

    if (catalogColumn === undefined) {
      diagnostics.push(
        errorDiagnostic(
          "omitted-fact",
          `Snapshot column "${column.physicalName}" is missing from its catalog table`,
          path,
        ),
      )
      continue
    }

    if (column.storage?.kind !== "native") {
      diagnostics.push(
        errorDiagnostic(
          "unrepresentable-fact",
          `Introspected column "${column.physicalName}" must retain exact native storage`,
          [...path, "storage"],
        ),
      )
      continue
    }

    if (column.storage.dialect !== catalog.dialect) {
      diagnostics.push(
        errorDiagnostic(
          "unrepresentable-fact",
          `Column storage dialect "${column.storage.dialect}" does not match "${catalog.dialect}"`,
          [...path, "storage", "dialect"],
        ),
      )
      continue
    }

    if (column.storage.type.trim().length === 0) {
      diagnostics.push(
        errorDiagnostic("unrepresentable-fact", "Native storage declarations cannot be empty", [
          ...path,
          "storage",
          "type",
        ]),
      )
      continue
    }

    if (!hasCompleteColumnBehavior(column)) {
      diagnostics.push(
        errorDiagnostic(
          "omitted-fact",
          `Column "${column.physicalName}" omits metadata required to reconstruct its write behavior`,
          path,
        ),
      )
      continue
    }

    const name = resolveName(
      {
        kind: "column",
        physicalName: column.physicalName,
        suggestedName: camelCase(column.physicalName),
        tablePhysicalName: snapshot.physicalName,
        tableName,
      },
      options,
      path,
      false,
      diagnostics,
    )

    if (name === undefined) {
      continue
    }

    addUniqueName(name, path, columnNames, diagnostics)

    const suggestedSqlDomain = inferSqlDomain(catalog.dialect, catalogColumn)
    const mapping = resolveColumnMapping(
      catalog,
      catalogTable.physicalName,
      tableName,
      catalogColumn,
      name,
      suggestedSqlDomain,
      options,
      path,
      diagnostics,
    )

    if (mapping === undefined) {
      continue
    }

    columns.push({
      name,
      snapshot: column,
      catalog: catalogColumn,
      output: mapping.output ?? "unknown",
      insert: mapping.insert ?? "unknown",
      update: mapping.update ?? "unknown",
      sqlDomain: mapping.sqlDomain ?? suggestedSqlDomain,
      explicitSqlDomain: mapping.sqlDomain !== undefined,
    })
  }

  const constraints = resolveObjects(
    snapshot.constraints,
    "constraint",
    snapshot,
    tableName,
    options,
    diagnostics,
  )
  const indexes = resolveObjects(
    snapshot.indexes,
    "index",
    snapshot,
    tableName,
    options,
    diagnostics,
  )

  if (hasErrors(diagnostics)) {
    return undefined
  }

  const orderedColumns = columns

  return {
    name: tableName,
    snapshot,
    catalog: catalogTable,
    columns: orderedColumns,
    columnsBySnapshotId: new Map(orderedColumns.map((column) => [column.snapshot.id, column])),
    constraints,
    indexes,
  }
}

function resolveObjects<TObject extends SnapshotConstraint | SnapshotIndex>(
  objects: readonly TObject[],
  kind: "constraint" | "index",
  table: SnapshotTable,
  tableName: string,
  options: SchemaCodegenOptions,
  diagnostics: CodegenDiagnostic[],
): readonly {
  readonly name: string
  readonly snapshot: TObject
}[] {
  const names = new Map<string, readonly (string | number)[]>()
  const result: {
    readonly name: string
    readonly snapshot: TObject
  }[] = []

  for (const object of [...objects].sort(comparePhysicalName)) {
    const path = [
      "snapshot",
      "tables",
      table.id,
      kind === "constraint" ? "constraints" : "indexes",
      object.id,
    ] as const
    const name = resolveName(
      {
        kind,
        physicalName: object.physicalName,
        suggestedName: camelCase(object.physicalName),
        tablePhysicalName: table.physicalName,
        tableName,
      },
      options,
      path,
      false,
      diagnostics,
    )

    if (name === undefined) {
      continue
    }

    addUniqueName(name, path, names, diagnostics)
    result.push({
      name,
      snapshot: object,
    })
  }

  return result.sort(compareName)
}

function resolveColumnMapping(
  catalog: IntrospectionCatalog,
  tablePhysicalName: string,
  tableName: string,
  column: CatalogColumn,
  columnName: string,
  suggestedSqlDomain: CodegenSqlDomain,
  options: SchemaCodegenOptions,
  path: readonly (string | number)[],
  diagnostics: CodegenDiagnostic[],
): CodegenColumnMapping | undefined {
  if (options.mapColumn === undefined) {
    return {}
  }

  if (typeof options.mapColumn !== "function") {
    diagnostics.push(
      errorDiagnostic("invalid-option", "mapColumn must be a function", ["options", "mapColumn"]),
    )
    return undefined
  }

  let mapping: CodegenColumnMapping | undefined

  try {
    mapping = options.mapColumn({
      dialect: catalog.dialect,
      namespace: catalog.namespace.name,
      tablePhysicalName,
      tableName,
      columnPhysicalName: column.physicalName,
      columnName,
      nativeType: column.storage.nativeType,
      portableType: column.storage.portable?.type,
      classificationConfidence: column.storage.portable?.confidence,
      suggestedSqlDomain,
    })
  } catch (caught) {
    diagnostics.push(
      errorDiagnostic(
        "invalid-option",
        caught instanceof Error
          ? `Column mapping failed: ${caught.message}`
          : "Column mapping failed",
        [...path, "mapping"],
      ),
    )
    return undefined
  }

  if (mapping === undefined) {
    return {}
  }

  if (typeof mapping !== "object" || mapping === null || Array.isArray(mapping)) {
    diagnostics.push(
      errorDiagnostic("invalid-option", "Column mappings must return an object or undefined", [
        ...path,
        "mapping",
      ]),
    )
    return undefined
  }

  for (const axis of ["output", "insert", "update"] as const) {
    const value = mapping[axis]

    if (value !== undefined && !applicationTypes.has(value)) {
      diagnostics.push(
        errorDiagnostic(
          "invalid-option",
          `Unsupported ${axis} application type "${String(value)}"`,
          [...path, "mapping", axis],
        ),
      )
    }
  }

  if (mapping.sqlDomain !== undefined && !sqlDomains.has(mapping.sqlDomain)) {
    diagnostics.push(
      errorDiagnostic("invalid-option", `Unsupported SQL domain "${String(mapping.sqlDomain)}"`, [
        ...path,
        "mapping",
        "sqlDomain",
      ]),
    )
  }

  return hasErrors(diagnostics) ? undefined : mapping
}

function validateResolvedDomains(schema: ResolvedSchema, diagnostics: CodegenDiagnostic[]): void {
  for (const table of schema.tables) {
    for (const index of table.indexes) {
      for (const term of index.snapshot.terms) {
        const ordered = term.direction !== undefined || term.nulls !== undefined ? term : undefined

        if (ordered?.kind !== "column") {
          continue
        }

        const column = table.columnsBySnapshotId.get(ordered.column)

        if (column === undefined || orderableDomains.has(column.sqlDomain)) {
          continue
        }

        if (column.explicitSqlDomain) {
          diagnostics.push(
            errorDiagnostic(
              "invalid-option",
              `SQL domain "${column.sqlDomain}" cannot represent an ordered index term`,
              ["snapshot", "tables", table.snapshot.id, "indexes", index.snapshot.id, "terms"],
            ),
          )
        } else {
          column.sqlDomain = "unknown"
        }
      }
    }
  }

  for (const table of schema.tables) {
    for (const constraint of table.constraints) {
      if (constraint.snapshot.kind !== "foreign-key") {
        continue
      }

      const targetTable = schema.tablesBySnapshotId.get(constraint.snapshot.target.table.id)

      if (targetTable === undefined) {
        continue
      }

      for (const [index, localId] of constraint.snapshot.columns.entries()) {
        const targetId = constraint.snapshot.target.columns[index]
        const local = table.columnsBySnapshotId.get(localId)
        const target = targetId ? targetTable.columnsBySnapshotId.get(targetId) : undefined

        if (
          local === undefined ||
          target === undefined ||
          local.sqlDomain === "unknown" ||
          target.sqlDomain === "unknown" ||
          local.sqlDomain === target.sqlDomain
        ) {
          continue
        }

        if (local.explicitSqlDomain && target.explicitSqlDomain) {
          diagnostics.push(
            errorDiagnostic(
              "invalid-option",
              `Mapped foreign-key domains differ: "${local.sqlDomain}" and "${target.sqlDomain}"`,
              [
                "snapshot",
                "tables",
                table.snapshot.id,
                "constraints",
                constraint.snapshot.id,
                "columns",
                index,
              ],
            ),
          )
        } else if (!local.explicitSqlDomain) {
          local.sqlDomain = "unknown"
        } else {
          target.sqlDomain = "unknown"
        }
      }
    }
  }
}

function inferSqlDomain(dialect: CatalogDialect, column: CatalogColumn): CodegenSqlDomain {
  const portable = column.storage.portable

  if (portable?.confidence === "exact") {
    return portableDomain(portable.type)
  }

  const declaration = column.storage.nativeType.trim().toLowerCase()

  if (dialect === "postgresql") {
    switch (declaration) {
      case "smallint":
      case "integer": {
        return "integer"
      }

      case "bigint": {
        return "bigint"
      }

      case "numeric": {
        return "decimal"
      }

      case "text": {
        return "text"
      }

      case "boolean": {
        return "boolean"
      }

      case "date": {
        return "date"
      }

      case "timestamp without time zone":
      case "timestamp with time zone": {
        return "timestamp"
      }

      case "uuid": {
        return "uuid"
      }

      case "json":
      case "jsonb": {
        return "json"
      }

      case "bytea": {
        return "binary"
      }

      default: {
        return "unknown"
      }
    }
  }

  if (dialect === "mysql") {
    switch (declaration) {
      case "tinyint":
      case "smallint":
      case "mediumint":
      case "int": {
        return "integer"
      }

      case "bigint": {
        return "bigint"
      }

      case "decimal": {
        return "decimal"
      }

      case "text":
      case "tinytext":
      case "mediumtext":
      case "longtext": {
        return "text"
      }

      case "date": {
        return "date"
      }

      case "datetime":
      case "timestamp": {
        return "timestamp"
      }

      case "json": {
        return "json"
      }

      case "blob":
      case "tinyblob":
      case "mediumblob":
      case "longblob": {
        return "binary"
      }

      default: {
        return "unknown"
      }
    }
  }

  return "unknown"
}

function portableDomain(
  portable: NonNullable<CatalogColumn["storage"]["portable"]>["type"],
): CodegenSqlDomain {
  return portable === "numeric" ? "decimal" : portable
}

function resolveName(
  context: CodegenNameContext,
  options: SchemaCodegenOptions,
  path: readonly (string | number)[],
  exportBinding: boolean,
  diagnostics: CodegenDiagnostic[],
): string | undefined {
  let name: unknown = context.suggestedName

  if (options.naming !== undefined) {
    if (typeof options.naming !== "function") {
      diagnostics.push(
        errorDiagnostic("invalid-option", "naming must be a function", ["options", "naming"]),
      )
      return undefined
    }

    try {
      name = options.naming(context) ?? context.suggestedName
    } catch (caught) {
      diagnostics.push(
        errorDiagnostic(
          "invalid-option",
          caught instanceof Error
            ? `Naming callback failed: ${caught.message}`
            : "Naming callback failed",
          [...path, "name"],
        ),
      )
      return undefined
    }
  }

  if (
    typeof name !== "string" ||
    !/^[a-z][A-Za-z0-9]*$/u.test(name) ||
    (exportBinding && reservedBindings.has(name))
  ) {
    diagnostics.push(
      errorDiagnostic(
        "unsafe-name",
        `Physical ${context.kind} name ${JSON.stringify(context.physicalName)} does not resolve to a safe camelCase${
          exportBinding ? " export" : ""
        } identifier`,
        [...path, "name"],
        "Return a safe camelCase ID from the naming callback.",
      ),
    )
    return undefined
  }

  return name
}

function camelCase(value: string): string {
  const words = value
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .split(/[^A-Za-z0-9]+/u)
    .filter(Boolean)
    .map((word) => word.toLowerCase())
  const first = words.shift() ?? ""

  return `${first}${words
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join("")}`
}

function hasCompleteColumnBehavior(
  column: SchemaSnapshot["tables"][number]["columns"][number],
): boolean {
  const behaviorCount = [column.default, column.generatedColumn, column.identity].filter(
    (value) => value !== undefined,
  ).length

  if (behaviorCount > 1) {
    return false
  }

  if (column.generatedColumn !== undefined || column.identity !== undefined) {
    return column.generated && !column.hasDefault
  }

  if (column.default !== undefined) {
    return !column.generated && column.hasDefault
  }

  return !column.generated && !column.hasDefault
}

function toPhysicalFacts(snapshot: SchemaSnapshot): unknown {
  // IDs and introspection evidence are run-specific; compare physical facts and resolve references
  // by physical name so equivalent snapshots from separate introspection runs still match.
  const tableById = new Map(snapshot.tables.map((table) => [table.id, table]))
  const columnNames = new Map(
    snapshot.tables.map((table) => [
      table.id,
      new Map(table.columns.map((column) => [column.id, column.physicalName])),
    ]),
  )

  return {
    dialect: snapshot.dialect,
    namespace: snapshot.namespace.name,
    tables: [...snapshot.tables].sort(comparePhysicalName).map((table) => ({
      physicalName: table.physicalName,
      ...(table.dialect === undefined ? {} : { dialect: stripEvidence(table.dialect) }),
      columns: [...table.columns].sort(comparePhysicalPosition).map((column) =>
        stripObjectIdentity(column),
      ),
      constraints: [...table.constraints]
        .sort(comparePhysicalName)
        .map((constraint) => physicalConstraint(constraint, table, tableById, columnNames)),
      indexes: [...table.indexes]
        .sort(comparePhysicalName)
        .map((index) => physicalIndex(index, table, columnNames)),
    })),
  }
}

function physicalConstraint(
  constraint: SnapshotConstraint,
  table: SnapshotTable,
  tables: ReadonlyMap<string, SnapshotTable>,
  columns: ReadonlyMap<string, ReadonlyMap<string, string>>,
): unknown {
  if (constraint.kind === "check") {
    return stripObjectIdentity(constraint)
  }

  const localColumns = constraint.columns.map(
    (id) => columns.get(table.id)?.get(id) ?? `missing:${id}`,
  )

  if (constraint.kind !== "foreign-key") {
    const facts = stripObjectIdentity(constraint)

    return {
      ...facts,
      columns: localColumns,
      ...(constraint.backingIndex === undefined
        ? {}
        : {
            backingIndex: physicalReference(
              constraint.backingIndex,
              table.indexes,
            ),
          }),
    }
  }

  const targetTable = tables.get(constraint.target.table.id)

  return {
    ...stripObjectIdentity(constraint),
    columns: localColumns,
    target: {
      table: targetTable?.physicalName ?? `missing:${constraint.target.table.id}`,
      columns: constraint.target.columns.map(
        (id) => columns.get(constraint.target.table.id)?.get(id) ?? `missing:${id}`,
      ),
    },
  }
}

function physicalIndex(
  index: SnapshotIndex,
  table: SnapshotTable,
  columns: ReadonlyMap<string, ReadonlyMap<string, string>>,
): unknown {
  const names = columns.get(table.id)

  return {
    ...stripObjectIdentity(index),
    terms: [...index.terms]
      .sort((left, right) => left.position - right.position)
      .map((term) => physicalIndexTerm(term, names)),
    ...(index.includedColumns === undefined
      ? {}
      : {
          includedColumns: index.includedColumns.map((id) => names?.get(id) ?? `missing:${id}`),
        }),
    ...(index.backingConstraint === undefined
      ? {}
      : {
          backingConstraint: physicalReference(index.backingConstraint, table.constraints),
        }),
  }
}

function physicalIndexTerm(
  term: SnapshotIndexTerm,
  columns: ReadonlyMap<string, string> | undefined,
): unknown {
  if (term.kind === "column") {
    return {
      ...term,
      column: columns?.get(term.column) ?? `missing:${term.column}`,
    }
  }

  if (term.kind === "expression") {
    return term
  }

  return term
}

function appendUnsupportedSnapshotFamilyDiagnostics(
  snapshot: SchemaSnapshot,
  diagnostics: CodegenDiagnostic[],
): void {
  for (const [property, label] of unsupportedSnapshotFamilies) {
    const values = snapshot[property]

    if (values.length === 0) {
      continue
    }

    diagnostics.push(
      errorDiagnostic(
        "excluded-object-family",
        `Snapshot v1 source generation cannot represent ${values.length} ${label}`,
        ["snapshot", property],
        "Generate source from a snapshot containing tables only.",
      ),
    )
  }
}

function stripObjectIdentity(value: { readonly id: string }): Record<string, unknown> {
  const stripped = stripEvidence(value)

  if (typeof stripped !== "object" || stripped === null || Array.isArray(stripped)) {
    return {}
  }

  const { id: _id, ...facts } = stripped as Record<string, unknown>
  return facts
}

function stripEvidence(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripEvidence)
  }

  if (typeof value !== "object" || value === null) {
    return value
  }

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .flatMap(([key, item]) =>
      key === "provenance" || key === "physicalReference"
        ? []
        : [[key, stripEvidence(item)]],
      ),
  )
}

function physicalReference(
  reference: { readonly kind: string; readonly id: string },
  objects: readonly { readonly id: string; readonly physicalName: string }[],
): Record<string, unknown> {
  const target = objects.find((object) => object.id === reference.id)

  return {
    ...reference,
    id: target?.physicalName ?? `missing:${reference.id}`,
  }
}

function groupUnique<T>(
  values: readonly T[],
  keyOf: (value: T) => string,
  path: readonly (string | number)[],
  diagnostics: CodegenDiagnostic[],
): Map<string, T> {
  const result = new Map<string, T>()

  for (const [index, value] of values.entries()) {
    const key = keyOf(value)

    if (result.has(key)) {
      diagnostics.push(
        errorDiagnostic(
          "name-collision",
          `Physical name ${JSON.stringify(key)} occurs more than once`,
          [...path, index],
        ),
      )
    } else {
      result.set(key, value)
    }
  }

  return result
}

function addUniqueName(
  name: string,
  path: readonly (string | number)[],
  names: Map<string, readonly (string | number)[]>,
  diagnostics: CodegenDiagnostic[],
): void {
  const existing = names.get(name)

  if (existing === undefined) {
    names.set(name, path)
    return
  }

  diagnostics.push(
    errorDiagnostic(
      "name-collision",
      `More than one physical object resolves to logical ID "${name}"`,
      [...path, "name"],
      "Override one logical ID with the naming callback.",
      [existing],
    ),
  )
}

function errorDiagnostic(
  code: CodegenDiagnostic["code"],
  message: string,
  path: readonly (string | number)[],
  remediation?: string,
  relatedPaths?: readonly (readonly (string | number)[])[],
): CodegenDiagnostic {
  return {
    severity: "error",
    code,
    message,
    path,
    ...(remediation === undefined ? {} : { remediation }),
    ...(relatedPaths === undefined ? {} : { relatedPaths }),
  }
}

function failure(diagnostics: readonly CodegenDiagnostic[]): SchemaCodegenResult {
  return Object.freeze({
    ok: false as const,
    diagnostics: freezeDiagnostics(diagnostics),
  })
}

function freezeDiagnostics(
  diagnostics: readonly CodegenDiagnostic[],
): readonly CodegenDiagnostic[] {
  return Object.freeze(
    diagnostics.map((diagnostic) =>
      Object.freeze({
        ...diagnostic,
        path: Object.freeze([...diagnostic.path]),
        relatedPaths:
          diagnostic.relatedPaths === undefined
            ? undefined
            : Object.freeze(diagnostic.relatedPaths.map((path) => Object.freeze([...path]))),
      }),
    ),
  )
}

function hasErrors(diagnostics: readonly CodegenDiagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error")
}

function comparePhysicalName(
  left: { readonly physicalName: string },
  right: { readonly physicalName: string },
): number {
  return left.physicalName < right.physicalName
    ? -1
    : left.physicalName > right.physicalName
      ? 1
      : 0
}

function comparePhysicalPosition(
  left: { readonly ordinalPosition: number; readonly physicalName: string },
  right: { readonly ordinalPosition: number; readonly physicalName: string },
): number {
  return left.ordinalPosition - right.ordinalPosition || comparePhysicalName(left, right)
}

function compareName(left: { readonly name: string }, right: { readonly name: string }): number {
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0
}

function isOptions(value: unknown): value is SchemaCodegenOptions {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function validateOptions(
  options: SchemaCodegenOptions,
  diagnostics: CodegenDiagnostic[],
): boolean {
  let valid = true

  for (const key of ["naming", "mapColumn"] as const) {
    const callback = options[key]

    if (callback !== undefined && typeof callback !== "function") {
      diagnostics.push(
        errorDiagnostic("invalid-option", `${key} must be a function`, ["options", key]),
      )
      valid = false
    }
  }

  return valid
}

function isIntrospectionResult(value: unknown): value is IntrospectionResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    typeof value.ok === "boolean" &&
    "lossy" in value &&
    typeof value.lossy === "boolean" &&
    "diagnostics" in value &&
    Array.isArray(value.diagnostics)
  )
}
