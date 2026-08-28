import type { CatalogConnection } from "./connection.ts"
import { createIntrospectionDiagnostic } from "./diagnostics.ts"
import type {
  CatalogCheckConstraint,
  CatalogColumn,
  CatalogConstraint,
  CatalogDeferredObject,
  CatalogDialectExtension,
  CatalogForeignKeyConstraint,
  CatalogIdentity,
  CatalogIndex,
  CatalogIndexTerm,
  CatalogObjectReference,
  CatalogOpaqueObject,
  CatalogPrimaryKeyConstraint,
  CatalogQueryRow,
  CatalogReference,
  CatalogServerInfo,
  CatalogSqlExpression,
  CatalogTable,
  CatalogTrigger,
  CatalogUniqueConstraint,
  CatalogView,
  IntrospectionCatalog,
  IntrospectionOptions,
} from "./types.ts"

export const sqliteServerQuery = `SELECT sqlite_version() AS version, sqlite_source_id() AS source_id`
export const sqliteDatabaseListQuery = `
  SELECT seq, name, file
  FROM pragma_database_list()
  ORDER BY seq
`
export const sqliteSchemaQuery = `
  SELECT type, name, tbl_name, sql
  FROM main.sqlite_schema
  WHERE name NOT LIKE 'sqlite_%'
  ORDER BY type, name
`
export const sqliteTempSchemaQuery = `
  SELECT type, name, tbl_name, sql
  FROM temp.sqlite_schema
  WHERE name NOT LIKE 'sqlite_%'
  ORDER BY type, name
`
export const sqliteTableListQuery = `
  SELECT schema, name, type, ncol, wr, strict
  FROM pragma_table_list
  WHERE schema = ? AND name NOT LIKE 'sqlite_%'
  ORDER BY name
`
export const sqliteTableInfoQuery = `
  SELECT cid, name, type, "notnull" AS not_null, dflt_value, pk, hidden
  FROM pragma_table_xinfo(?, ?)
  ORDER BY cid
`
export const sqliteIndexListQuery = `
  SELECT seq, name, "unique" AS unique_index, origin, partial
  FROM pragma_index_list(?, ?)
  ORDER BY seq
`
export const sqliteIndexInfoQuery = `
  SELECT seqno, cid, name, "desc" AS descending, coll, key
  FROM pragma_index_xinfo(?, ?)
  ORDER BY seqno
`
export const sqliteForeignKeyQuery = `
  SELECT id, seq, "table" AS target_table, "from" AS source_column,
         "to" AS target_column, on_update, on_delete, match
  FROM pragma_foreign_key_list(?, ?)
  ORDER BY id, seq
`

/** Read the selected SQLite database namespace into the normalized catalog. */
export async function readSqliteCatalog(
  connection: CatalogConnection,
  options: IntrospectionOptions,
): Promise<IntrospectionCatalog> {
  const diagnostics = [] as IntrospectionCatalog["diagnostics"][number][]

  if (connection.dialect !== "sqlite") {
    diagnostics.push(
      createIntrospectionDiagnostic({
        severity: "error",
        code: "dialect-mismatch",
        message: "SQLite catalog reading requires a SQLite CatalogConnection",
        path: ["connection", "dialect"],
      }),
    )
    return emptyCatalog(options.namespace, diagnostics)
  }

  const serverRows = await query<SqliteServerRow>(
    connection,
    sqliteServerQuery,
    [],
    options,
    diagnostics,
    "server",
  )
  const server = serverInfo(serverRows[0], diagnostics)
  const databaseRows = await query<SqliteDatabaseRow>(
    connection,
    sqliteDatabaseListQuery,
    [],
    options,
    diagnostics,
    "database-list",
  )
  const databaseNames = databaseRows
    .map((row) => text(row.name))
    .filter((name): name is string => name !== undefined)

  if (databaseNames.length > 0 && !databaseNames.includes(options.namespace)) {
    diagnostics.push(
      createIntrospectionDiagnostic({
        severity: "error",
        code: "missing-catalog-row",
        message: `SQLite database ${options.namespace} is not attached to the selected connection`,
        path: ["namespace", options.namespace],
        remediation: "Attach the database before starting introspection.",
      }),
    )
  }

  const schemaRows =
    options.namespace === "main" || options.namespace === "temp"
      ? await query<SqliteSchemaRow>(
          connection,
          options.namespace === "temp" ? sqliteTempSchemaQuery : sqliteSchemaQuery,
          [],
          options,
          diagnostics,
          "schema",
        )
      : []

  if (
    options.namespace !== "main" &&
    options.namespace !== "temp" &&
    databaseNames.includes(options.namespace)
  ) {
    diagnostics.push(
      createIntrospectionDiagnostic({
        severity: "warning",
        code: "partial-result",
        message: `SQLite attached database ${options.namespace} exposes table PRAGMAs but its schema SQL is outside the fixed main/temp catalog statements`,
        path: ["namespace", options.namespace, "schema"],
        remediation:
          "Use a driver adapter that exposes the attached schema through a fixed statement before relying on generated SQL.",
      }),
    )
  }

  const tableRows = await query<SqliteTableListRow>(
    connection,
    sqliteTableListQuery,
    [options.namespace],
    options,
    diagnostics,
    "table-list",
  )
  const tableSql = new Map(
    schemaRows
      .map((row) => [text(row.name), text(row.sql)] as const)
      .filter((entry): entry is readonly [string, string | undefined] => entry[0] !== undefined),
  )
  const tables = tableRows
    .filter((row) => normalizeType(row.type) === "table")
    .map((row) => table(row, tableSql.get(text(row.name) ?? "") ?? undefined, options.namespace))
  const deferredObjects: CatalogDeferredObject[] = []
  const opaqueObjects: CatalogOpaqueObject[] = []

  for (const row of tableRows) {
    const type = normalizeType(row.type)

    if (type !== "virtual" && type !== "shadow") {
      continue
    }

    const physicalName = text(row.name) ?? "unnamed_object"

    deferredObjects.push(
      deferred(
        type === "virtual" ? "virtual-table" : "shadow-table",
        physicalName,
        tableSql.get(physicalName),
        options.namespace,
      ),
    )
    diagnostics.push(
      createIntrospectionDiagnostic({
        severity: "warning",
        code: "unmodeled-object",
        message: `SQLite ${type} table ${physicalName} is retained as a deferred object`,
        path: ["deferredObjects", physicalName],
        physicalReference: reference(
          "deferred-object",
          physicalName,
          options.namespace,
          "pragma_table_list",
          "name",
        ),
        remediation: "Inspect the deferred record before using it as migration input.",
      }),
    )
  }

  for (const row of databaseRows) {
    const name = text(row.name)

    if (!name || name === options.namespace || name === "main" || name === "temp") {
      continue
    }

    const boundary = attachedDatabaseObject(row, options.namespace)

    opaqueObjects.push(boundary)
    diagnostics.push(
      createIntrospectionDiagnostic({
        severity: "info",
        code: "partial-result",
        message: `Attached SQLite database ${name} is outside the selected namespace`,
        path: ["namespace", "attached", name],
        physicalReference: boundary.reference,
        remediation: "Run a separate catalog read with this database name to inspect it.",
      }),
    )
  }

  const views: CatalogView[] = []

  for (const row of tableRows.filter((row) => normalizeType(row.type) === "view")) {
    const physicalName = text(row.name) ?? "unnamed_view"
    const view = sqliteView(row, tableSql.get(physicalName), options.namespace, diagnostics)

    if (view.kind === "deferred-object") {
      deferredObjects.push(view)
    } else {
      views.push(view)
    }
  }

  const relationReferences = new Map<string, CatalogObjectReference>()

  for (const table of tables) {
    relationReferences.set(table.physicalName, {
      kind: "table",
      id: table.id,
    })
  }

  for (const view of views) {
    relationReferences.set(view.physicalName, {
      kind: view.kind,
      id: view.id,
    })
  }

  const triggers: CatalogTrigger[] = []

  for (const currentTable of tables) {
    const tableName = currentTable.physicalName
    const rows = await query<SqliteColumnRow>(
      connection,
      sqliteTableInfoQuery,
      [tableName, options.namespace],
      options,
      diagnostics,
      `table-xinfo:${tableName}`,
    )
    const sqlText = tableSql.get(tableName)
    const rowidPrimaryKey = rows.filter((row) => (number(row.pk) ?? 0) > 0).length === 1
    const columns = rows
      .filter((row) => number(row.hidden) !== 1)
      .map((row) =>
        column(row, currentTable, options.namespace, sqlText, rowidPrimaryKey, diagnostics),
      )

    ;(currentTable as Mutable<CatalogTable>).columns = columns
    ;(currentTable as Mutable<CatalogTable>).constraints = tableConstraints(
      currentTable,
      rows,
      columns,
      sqlText,
      options.namespace,
    )
    const indexRows = await query<SqliteIndexListRow>(
      connection,
      sqliteIndexListQuery,
      [tableName, options.namespace],
      options,
      diagnostics,
      `index-list:${tableName}`,
    )
    const mappedIndexes: CatalogIndex[] = []
    const mappedConstraints: CatalogConstraint[] = [
      ...(currentTable.constraints as readonly CatalogConstraint[]),
    ]

    for (const indexRow of indexRows) {
      const indexName = text(indexRow.name)

      if (
        !indexName ||
        (indexName.startsWith("sqlite_autoindex_") && text(indexRow.origin)?.toLowerCase() !== "u")
      ) {
        continue
      }

      const infoRows = await query<SqliteIndexInfoRow>(
        connection,
        sqliteIndexInfoQuery,
        [indexName, options.namespace],
        options,
        diagnostics,
        `index-info:${indexName}`,
      )
      const index = sqliteIndex(
        currentTable,
        indexRow,
        infoRows,
        tableSql.get(indexName),
        options.namespace,
        diagnostics,
        opaqueObjects,
      )

      if (!index) {
        continue
      }

      if (index.kind === "index") {
        mappedIndexes.push(index)
      } else {
        mappedConstraints.push(index)
      }
    }

    const foreignRows = await query<SqliteForeignKeyRow>(
      connection,
      sqliteForeignKeyQuery,
      [tableName, options.namespace],
      options,
      diagnostics,
      `foreign-key:${tableName}`,
    )

    mappedConstraints.push(...foreignKeys(currentTable, foreignRows, options.namespace))
    ;(currentTable as Mutable<CatalogTable>).indexes = mappedIndexes
    ;(currentTable as Mutable<CatalogTable>).constraints = mappedConstraints
  }

  for (const view of views) {
    const rows = await query<SqliteColumnRow>(
      connection,
      sqliteTableInfoQuery,
      [view.physicalName, options.namespace],
      options,
      diagnostics,
      `view-xinfo:${view.physicalName}`,
    )

    ;(view as Mutable<CatalogView>).columns = rows
      .filter((row) => number(row.hidden) !== 1)
      .map((row) => column(row, view, options.namespace, undefined, false, diagnostics))
  }

  for (const row of schemaRows.filter((row) => normalizeType(row.type) === "trigger")) {
    const trigger = sqliteTrigger(row, options.namespace, relationReferences, diagnostics)

    if (trigger.kind === "deferred-object") {
      deferredObjects.push(trigger)
    } else {
      triggers.push(trigger)
    }
  }

  for (const row of schemaRows) {
    const type = normalizeType(row.type)

    if (type === "table" || type === "view" || type === "trigger" || type === "index") {
      continue
    }

    const physicalName = text(row.name) ?? "unnamed_object"

    opaqueObjects.push(opaqueSchemaObject(row, options.namespace, diagnostics))
    diagnostics.push(
      createIntrospectionDiagnostic({
        severity: "warning",
        code: "unmodeled-object",
        message: `SQLite schema object ${physicalName} (${type || "unknown"}) is retained as opaque data`,
        path: ["opaqueObjects", physicalName],
        physicalReference: reference(
          "opaque-object",
          physicalName,
          options.namespace,
          "sqlite_schema",
          "name",
        ),
      }),
    )
  }

  const visibility =
    databaseRows.length > 0 && options.namespace !== "main" && options.namespace !== "temp"
      ? ("limited" as const)
      : server.capabilities.visibility
  const capabilities = {
    generatedColumns: server.capabilities.generatedColumns,
    identityMetadata: server.capabilities.identityMetadata,
    checkConstraints: server.capabilities.checkConstraints,
    checkConstraintEnforcement: server.capabilities.checkConstraintEnforcement,
    expressionDecompilation: server.capabilities.expressionDecompilation,
    indexExpressions: server.capabilities.indexExpressions,
    indexPredicates: server.capabilities.indexPredicates,
    indexIncludedColumns: server.capabilities.indexIncludedColumns,
    namespaces: server.capabilities.namespaces,
    visibility,
  }
  const serverCapabilities = {
    ...server.capabilities,
    attachedDatabases: true,
    views: true,
    triggers: true,
    virtualTables: true,
    shadowTables: true,
    comments: false,
    ownership: false,
    typedExtensions: true,
    affinityFacts: true,
    generatedSql: true,
    selectedNamespace: options.namespace,
    visibility,
  }

  return Object.freeze({
    dialect: "sqlite" as const,
    server: {
      ...server,
      capabilities: serverCapabilities,
    },
    namespace: {
      kind: "sqlite-database" as const,
      name: options.namespace,
      reference: reference(
        "namespace",
        options.namespace,
        options.namespace,
        "sqlite_schema",
        "name",
      ),
      dialect: sqliteExtension({
        selectedNamespace: options.namespace,
        sourceIdAvailable: serverSourceIdAvailable(serverRows[0]),
        views: true,
        triggers: true,
        virtualTables: true,
        shadowTables: true,
        comments: false,
        ownership: false,
        typedExtensions: true,
        affinityFacts: true,
        generatedSql: true,
        visibility,
        attachedDatabases: databaseNames.filter((name) => name !== options.namespace),
      }),
    },
    tables: Object.freeze(tables),
    views: Object.freeze(views),
    triggers: Object.freeze(triggers),
    deferredObjects: Object.freeze(deferredObjects),
    opaqueObjects: Object.freeze(opaqueObjects),
    capabilities,
    diagnostics: Object.freeze(diagnostics),
  })
}

interface SqliteServerRow extends CatalogQueryRow {
  readonly version?: unknown
  readonly source_id?: unknown
}
interface SqliteDatabaseRow extends CatalogQueryRow {
  readonly seq?: unknown
  readonly name?: unknown
  readonly file?: unknown
}
interface SqliteSchemaRow extends CatalogQueryRow {
  readonly type?: unknown
  readonly name?: unknown
  readonly tbl_name?: unknown
  readonly sql?: unknown
}
interface SqliteTableListRow extends CatalogQueryRow {
  readonly schema?: unknown
  readonly name?: unknown
  readonly type?: unknown
  readonly ncol?: unknown
  readonly wr?: unknown
  readonly strict?: unknown
}
interface SqliteColumnRow extends CatalogQueryRow {
  readonly cid?: unknown
  readonly name?: unknown
  readonly type?: unknown
  readonly not_null?: unknown
  readonly dflt_value?: unknown
  readonly pk?: unknown
  readonly hidden?: unknown
}
interface SqliteIndexListRow extends CatalogQueryRow {
  readonly seq?: unknown
  readonly name?: unknown
  readonly unique_index?: unknown
  readonly origin?: unknown
  readonly partial?: unknown
}
interface SqliteIndexInfoRow extends CatalogQueryRow {
  readonly seqno?: unknown
  readonly cid?: unknown
  readonly name?: unknown
  readonly descending?: unknown
  readonly coll?: unknown
  readonly key?: unknown
}
interface SqliteForeignKeyRow extends CatalogQueryRow {
  readonly id?: unknown
  readonly seq?: unknown
  readonly target_table?: unknown
  readonly source_column?: unknown
  readonly target_column?: unknown
  readonly on_update?: unknown
  readonly on_delete?: unknown
  readonly match?: unknown
}

type Mutable<T> = { -readonly [Key in keyof T]: T[Key] }

async function query<Row extends CatalogQueryRow>(
  connection: CatalogConnection,
  textValue: string,
  parameters: readonly unknown[],
  options: IntrospectionOptions,
  diagnostics: IntrospectionCatalog["diagnostics"][number][],
  operation: string,
): Promise<readonly Row[]> {
  try {
    return await connection.query<Row>(
      {
        text: textValue,
        parameters,
      },
      { signal: options.signal },
    )
  } catch {
    diagnostics.push(
      createIntrospectionDiagnostic({
        severity: "error",
        code: "query-failed",
        message: `SQLite catalog query failed while reading ${operation}`,
        path: [operation],
        remediation: "Check SQLite metadata visibility and the selected database.",
      }),
    )
    return []
  }
}

function serverInfo(
  row: SqliteServerRow | undefined,
  diagnostics: IntrospectionCatalog["diagnostics"][number][],
): CatalogServerInfo {
  const rawVersion = text(row?.version) ?? "unknown"
  const parts = rawVersion.split(".").map((item) => Number(item))
  const supported = parts.length >= 2 && parts[0] === 3 && parts[1] >= 37

  if (!supported) {
    diagnostics.push(
      createIntrospectionDiagnostic({
        severity: "error",
        code: "unsupported-server",
        message: "SQLite introspection requires SQLite 3.37 or newer",
        path: ["server", "version"],
        remediation: "Use SQLite 3.37+ or provide a compatible adapter capability set.",
      }),
    )
  }

  return {
    product: "sqlite",
    rawVersion,
    parsedVersion: Number.isFinite(parts[0])
      ? {
          major: parts[0],
          minor: parts[1],
          patch: parts[2],
        }
      : undefined,
    capabilities: {
      generatedColumns: supported,
      identityMetadata: true,
      checkConstraints: true,
      checkConstraintEnforcement: "enforced",
      expressionDecompilation: false,
      indexExpressions: true,
      indexPredicates: true,
      indexIncludedColumns: false,
      namespaces: false,
      visibility: "complete",
      sourceIdAvailable: text(row?.source_id) !== undefined,
    },
  }
}

function serverSourceIdAvailable(row: SqliteServerRow | undefined): boolean {
  return text(row?.source_id) !== undefined
}

function normalizeType(value: unknown): string {
  return text(value)?.trim().toLowerCase() ?? ""
}

function sqliteView(
  row: SqliteTableListRow,
  sqlText: string | undefined,
  namespace: string,
  diagnostics: IntrospectionCatalog["diagnostics"][number][],
): CatalogView | CatalogDeferredObject {
  const physicalName = text(row.name) ?? "unnamed_view"
  const physicalReference = reference("view", physicalName, namespace, "sqlite_schema", "name")
  const definition = viewDefinition(sqlText)

  if (!definition) {
    diagnostics.push(
      createIntrospectionDiagnostic({
        severity: "error",
        code: "expression-parse-failed",
        message: `SQLite view ${physicalName} has no recoverable SELECT definition`,
        path: ["views", physicalName, "definition"],
        physicalReference,
        remediation: "Preserve the CREATE VIEW SQL returned by sqlite_schema.",
      }),
    )
    return deferred("view", physicalName, sqlText, namespace)
  }

  return {
    kind: "view",
    id: stableId(physicalName),
    identitySource: "physical-name",
    physicalName,
    columns: [],
    definition: sql(
      definition,
      namespace,
      {
        kind: "view",
        physicalName,
        reference: physicalReference,
      },
      physicalName,
    ),
    reference: physicalReference,
    provenance: {
      kind: "create-sql",
      dialect: "sqlite",
      reference: physicalReference,
    },
    dialect: sqliteExtension({ objectKind: "view" }),
  }
}

function viewDefinition(sqlText: string | undefined): string | undefined {
  if (!sqlText) {
    return undefined
  }

  const match = sqlText.match(/\bAS\b([\s\S]*)$/i)
  const definition = match?.[1]?.trim().replace(/;\s*$/, "")

  return definition || undefined
}

function attachedDatabaseObject(
  row: SqliteDatabaseRow,
  selectedNamespace: string,
): CatalogOpaqueObject {
  const physicalName = text(row.name) ?? "unnamed_database"
  const physicalReference = reference(
    "opaque-object",
    physicalName,
    selectedNamespace,
    "pragma_database_list",
    "name",
  )

  return {
    kind: "opaque-object",
    id: stableId(`attached:${physicalName}`),
    identitySource: "physical-name",
    objectKind: "attached-database",
    physicalName,
    data: {
      ...(number(row.seq) === undefined ? {} : { sequence: number(row.seq)! }),
      ...(text(row.file) === undefined ? {} : { file: text(row.file)! }),
      selected: false,
    },
    reference: physicalReference,
    provenance: {
      kind: "catalog",
      dialect: "sqlite",
      reference: physicalReference,
    },
    dialect: sqliteExtension({ selectedNamespace }),
  }
}

function opaqueSchemaObject(
  row: SqliteSchemaRow,
  namespace: string,
  _diagnostics: IntrospectionCatalog["diagnostics"][number][],
): CatalogOpaqueObject {
  const physicalName = text(row.name) ?? "unnamed_object"
  const type = normalizeType(row.type) || "unknown"
  const physicalReference = reference(
    "opaque-object",
    physicalName,
    namespace,
    "sqlite_schema",
    "name",
  )
  const sqlText = text(row.sql)

  return {
    kind: "opaque-object",
    id: stableId(`opaque:${type}:${physicalName}`),
    identitySource: "physical-name",
    objectKind: type,
    physicalName,
    data: {
      type,
      ...(text(row.tbl_name) === undefined ? {} : { tableName: text(row.tbl_name)! }),
    },
    ...(sqlText === undefined
      ? {}
      : {
          sql: {
            kind: "sql" as const,
            dialect: "sqlite" as const,
            text: sqlText,
            provenance: {
              kind: "create-sql" as const,
              dialect: "sqlite" as const,
              reference: physicalReference,
            },
          },
        }),
    reference: physicalReference,
    provenance: {
      kind: "catalog",
      dialect: "sqlite",
      reference: physicalReference,
    },
    dialect: sqliteExtension({ objectKind: type }),
  }
}

function sqliteTrigger(
  row: SqliteSchemaRow,
  namespace: string,
  relations: ReadonlyMap<string, CatalogObjectReference>,
  diagnostics: IntrospectionCatalog["diagnostics"][number][],
): CatalogTrigger | CatalogDeferredObject {
  const physicalName = text(row.name) ?? "unnamed_trigger"
  const sqlText = text(row.sql)
  const physicalReference = reference("trigger", physicalName, namespace, "sqlite_schema", "name")
  const onMatch = sqlText?.match(
    /\bON\s+("(?:[^"]|"")*"|`[^`]*`|\[[^\]]*\]|[A-Za-z_][A-Za-z0-9_$]*)/i,
  )
  const targetName = unquoteIdentifier(onMatch?.[1]) ?? text(row.tbl_name)
  const target = targetName === undefined ? undefined : relations.get(targetName)
  const beginIndex = sqlText?.search(/\bBEGIN\b/i) ?? -1
  const header = sqlText === undefined || beginIndex < 0 ? undefined : sqlText.slice(0, beginIndex)
  const timing = triggerTiming(header)
  const events = triggerEvents(header)

  if (!sqlText || !target || !header || beginIndex < 0) {
    diagnostics.push(
      createIntrospectionDiagnostic({
        severity: "error",
        code: "unresolved-reference",
        message: `SQLite trigger ${physicalName} does not have a recoverable body or target`,
        path: ["triggers", physicalName],
        physicalReference,
        remediation:
          "Retain the CREATE TRIGGER SQL and inspect the trigger after its target is visible.",
      }),
    )
    return deferred("trigger", physicalName, sqlText, namespace)
  }

  if (events.length === 0) {
    diagnostics.push(
      createIntrospectionDiagnostic({
        severity: "warning",
        code: "unsupported-feature",
        message: `SQLite trigger ${physicalName} has no recognized event`,
        path: ["triggers", physicalName, "events"],
        physicalReference,
      }),
    )
  }

  const bodyText = sqlText
    .slice(beginIndex + 5)
    .replace(/END\s*;?\s*$/i, "")
    .trim()
  const condition = triggerCondition(sqlText, onMatch?.index, beginIndex)
  const trigger: CatalogTrigger = {
    kind: "trigger",
    id: stableId(physicalName),
    identitySource: "physical-name",
    physicalName,
    table: target,
    timing,
    events,
    orientation: /\bFOR\s+EACH\s+ROW\b/i.test(header) ? "row" : undefined,
    ...(condition === undefined
      ? {}
      : {
          condition: sql(
            condition,
            namespace,
            {
              kind: target.kind,
              physicalName: target.id,
              reference: physicalReference,
            },
            physicalName,
          ),
        }),
    body: sql(
      bodyText || sqlText,
      namespace,
      {
        kind: "trigger",
        physicalName,
        reference: physicalReference,
      },
      physicalName,
    ),
    reference: physicalReference,
    provenance: {
      kind: "create-sql",
      dialect: "sqlite",
      reference: physicalReference,
    },
    dialect: sqliteExtension({
      objectKind: "trigger",
      ...(sqlText === undefined ? {} : { rawSql: sqlText }),
    }),
  }

  return trigger
}

function triggerTiming(header: string | undefined): CatalogTrigger["timing"] {
  const value = header?.match(/\b(INSTEAD\s+OF|BEFORE|AFTER)\b/i)?.[1]

  return value?.toLowerCase() === "before"
    ? "before"
    : value?.toLowerCase() === "after"
      ? "after"
      : value?.toLowerCase() === "instead of"
        ? "instead-of"
        : "unknown"
}

function triggerEvents(header: string | undefined): CatalogTrigger["events"] {
  const values = header?.match(/\b(INSERT|UPDATE|DELETE)\b/gi) ?? []

  return [...new Set(values.map((value) => value.toLowerCase()))] as CatalogTrigger["events"]
}

function triggerCondition(
  sqlText: string,
  _onIndex: number | undefined,
  beginIndex: number,
): string | undefined {
  const header = sqlText.slice(0, beginIndex)

  return header.match(/\bWHEN\s+([\s\S]+)$/i)?.[1]?.trim()
}

function unquoteIdentifier(value: string | undefined): string | undefined {
  if (!value) {
    return undefined
  }

  const trimmed = value.trim()

  if (trimmed.length < 2) {
    return trimmed
  }

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("`") && trimmed.endsWith("`"))
  ) {
    return trimmed.slice(1, -1).replace(/(""|``)/g, (match) => match[0]!)
  }

  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed.slice(1, -1)
  }

  return trimmed
}

function sqliteAffinity(type: string): "INTEGER" | "TEXT" | "BLOB" | "REAL" | "NUMERIC" {
  const normalized = type.trim().toUpperCase()

  if (/INT/.test(normalized)) {
    return "INTEGER"
  }

  if (/CHAR|CLOB|TEXT/.test(normalized)) {
    return "TEXT"
  }

  if (/REAL|FLOA|DOUB/.test(normalized)) {
    return "REAL"
  }

  if (normalized === "" || normalized === "BLOB") {
    return "BLOB"
  }

  return "NUMERIC"
}

function sqliteExtension(
  data: Record<string, string | number | boolean | readonly string[]>,
): CatalogDialectExtension {
  return {
    dialect: "sqlite",
    version: 1,
    data,
  }
}

function indexExpressionFor(sqlText: string | undefined, position: number): string | undefined {
  if (!sqlText) {
    return undefined
  }

  const open = sqlText.indexOf("(", sqlText.search(/\bON\b/i))

  if (open < 0) {
    return undefined
  }

  const close = matchingParen(sqlText, open)

  if (close < 0) {
    return undefined
  }

  const terms = splitSqlList(sqlText.slice(open + 1, close))
  const term = terms[position]?.trim()

  return term && !isSimpleIdentifier(term) ? term : undefined
}

function opaqueIndexExpression(
  table: CatalogTable,
  indexName: string,
  position: number,
  info: SqliteIndexInfoRow,
  sqlText: string | undefined,
  namespace: string,
): CatalogOpaqueObject {
  const physicalReference = reference(
    "opaque-object",
    `${indexName}:${position}`,
    namespace,
    "pragma_index_xinfo",
    "seqno",
    position,
  )

  return {
    kind: "opaque-object",
    id: stableId(`index-expression:${table.physicalName}:${indexName}:${position}`),
    identitySource: "deterministic-fallback",
    objectKind: "index-expression-term",
    physicalName: `${indexName}:${position}`,
    data: {
      index: indexName,
      position,
      cid: number(info.cid) ?? -2,
    },
    ...(sqlText === undefined
      ? {}
      : {
          sql: sql(sqlText, namespace, table, indexName),
        }),
    reference: physicalReference,
    provenance: {
      kind: "catalog",
      dialect: "sqlite",
      reference: physicalReference,
    },
    dialect: sqliteExtension({ objectKind: "index-expression-term" }),
  }
}

function matchingParen(source: string, open: number): number {
  let depth = 0
  let quote: "single" | "double" | "backtick" | "bracket" | undefined

  for (let index = open; index < source.length; index++) {
    const character = source[index]

    if (quote === "single") {
      if (character === "'" && source[index + 1] === "'") {
        index++
      } else if (character === "'") {
        quote = undefined
      }

      continue
    }

    if (quote === "double") {
      if (character === '"' && source[index + 1] === '"') {
        index++
      } else if (character === '"') {
        quote = undefined
      }

      continue
    }

    if (quote === "backtick") {
      if (character === "`") {
        quote = undefined
      }

      continue
    }

    if (quote === "bracket") {
      if (character === "]") {
        quote = undefined
      }

      continue
    }

    if (character === "'") {
      quote = "single"
    } else if (character === '"') {
      quote = "double"
    } else if (character === "`") {
      quote = "backtick"
    } else if (character === "[") {
      quote = "bracket"
    } else if (character === "(") {
      depth++
    } else if (character === ")" && --depth === 0) {
      return index
    }
  }

  return -1
}

function splitSqlList(source: string): string[] {
  const values: string[] = []
  let start = 0
  let depth = 0
  let quote: "single" | "double" | "backtick" | "bracket" | undefined

  for (let index = 0; index < source.length; index++) {
    const character = source[index]

    if (quote === "single") {
      if (character === "'" && source[index + 1] === "'") {
        index++
      } else if (character === "'") {
        quote = undefined
      }

      continue
    }

    if (quote === "double") {
      if (character === '"' && source[index + 1] === '"') {
        index++
      } else if (character === '"') {
        quote = undefined
      }

      continue
    }

    if (quote === "backtick") {
      if (character === "`") {
        quote = undefined
      }

      continue
    }

    if (quote === "bracket") {
      if (character === "]") {
        quote = undefined
      }

      continue
    }

    if (character === "'") {
      quote = "single"
    } else if (character === '"') {
      quote = "double"
    } else if (character === "`") {
      quote = "backtick"
    } else if (character === "[") {
      quote = "bracket"
    } else if (character === "(") {
      depth++
    } else if (character === ")") {
      depth--
    } else if (character === "," && depth === 0) {
      values.push(source.slice(start, index))
      start = index + 1
    }
  }

  values.push(source.slice(start))
  return values
}

function isSimpleIdentifier(value: string): boolean {
  return /^(?:[A-Za-z_][A-Za-z0-9_$]*|"(?:[^"]|"")*"|`[^`]*`|\[[^\]]*\])(?:\s+(?:ASC|DESC))?$/i.test(
    value,
  )
}

function table(
  row: SqliteTableListRow,
  sqlText: string | undefined,
  namespace: string,
): CatalogTable {
  const physicalName = text(row.name) ?? "unnamed_table"
  const withoutRowid = boolean(row.wr)
  const strict = boolean(row.strict)

  return {
    kind: "table",
    id: stableId(physicalName),
    identitySource: "physical-name",
    physicalName,
    reference: reference("table", physicalName, namespace, "sqlite_schema", "name"),
    columns: [],
    constraints: [],
    indexes: [],
    dialect: sqliteExtension({
      tableType: "table",
      withoutRowid,
      strict,
      rowid: !withoutRowid,
    }),
    unknownFields: [
      ...(withoutRowid
        ? [
            {
              name: "withoutRowid",
              value: true as const,
            },
          ]
        : []),
      ...(strict
        ? [
            {
              name: "strict",
              value: true as const,
            },
          ]
        : []),
      ...(sqlText
        ? [
            {
              name: "createSql",
              value: sqlText,
            },
          ]
        : []),
    ],
  }
}

function deferred(
  objectKind: CatalogDeferredObject["objectKind"],
  physicalName: string,
  sqlText: string | undefined,
  namespace: string,
): CatalogDeferredObject {
  return {
    kind: "deferred-object",
    id: stableId(`deferred:${objectKind}:${physicalName}`),
    identitySource: "physical-name",
    objectKind,
    physicalName,
    reference: reference("deferred-object", physicalName, namespace, "sqlite_schema", "name"),
    dialect: sqliteExtension({ objectKind }),
    unknownFields: sqlText
      ? [
          {
            name: "createSql",
            value: sqlText,
          },
        ]
      : undefined,
  }
}

function column(
  row: SqliteColumnRow,
  table: CatalogTable | CatalogView,
  namespace: string,
  sqlText: string | undefined,
  rowidPrimaryKey: boolean,
  diagnostics: IntrospectionCatalog["diagnostics"][number][],
): CatalogColumn {
  const physicalName = text(row.name) ?? "unnamed_column"
  const hidden = number(row.hidden) ?? 0
  const type = text(row.type) ?? ""
  const defaultValue = text(row.dflt_value)
  const generatedExpression =
    hidden === 2 || hidden === 3 ? generatedExpressionFor(sqlText, physicalName) : undefined

  if ((hidden === 2 || hidden === 3) && !generatedExpression) {
    diagnostics.push(
      createIntrospectionDiagnostic({
        severity: "error",
        code: "expression-parse-failed",
        message: `SQLite generated expression for ${physicalName} could not be recovered`,
        path: [table.id, "columns", physicalName, "generated"],
        remediation: "Preserve the CREATE TABLE SQL or use lossy mode.",
      }),
    )
  }

  const rowid =
    table.kind === "table" &&
    rowidPrimaryKey &&
    (number(row.pk) ?? 0) > 0 &&
    type.toUpperCase() === "INTEGER" &&
    !/WITHOUT\s+ROWID/i.test(sqlText ?? "")
  const identity: CatalogIdentity | undefined = rowid
    ? {
        kind: "identity",
        generation: "by-default",
        options: {},
        dialect: {
          dialect: "sqlite",
          version: 1,
          data: {
            rowidAlias: true,
            autoIncrement: /AUTOINCREMENT/i.test(sqlText ?? ""),
            withoutRowid: false,
          },
        },
      }
    : undefined

  return {
    kind: "column",
    id: stableId(physicalName),
    identitySource: "physical-name",
    physicalName,
    ordinalPosition: number(row.cid) ?? 0,
    nullable:
      !boolean(row.not_null) &&
      !(
        rowid ||
        ((number(row.pk) ?? 0) > 0 &&
          (/WITHOUT\s+ROWID/i.test(sqlText ?? "") || /\bSTRICT\b/i.test(sqlText ?? "")))
      ),
    storage: { nativeType: type || "BLOB" },
    default:
      defaultValue !== undefined && !generatedExpression
        ? {
            kind: "expression",
            expression: sql(defaultValue, namespace, table, physicalName),
          }
        : undefined,
    generated: generatedExpression
      ? {
          kind: "generated",
          mode: hidden === 2 ? "virtual" : "stored",
          expression: sql(generatedExpression, namespace, table, physicalName),
        }
      : undefined,
    identity,
    reference: reference("column", physicalName, namespace, "pragma_table_xinfo", "name"),
    dialect: sqliteExtension({
      declaredType: type,
      affinity: sqliteAffinity(type),
      hidden,
    }),
  }
}

function tableConstraints(
  table: CatalogTable,
  rows: readonly SqliteColumnRow[],
  columns: readonly CatalogColumn[],
  sqlText: string | undefined,
  namespace: string,
): CatalogConstraint[] {
  const primaryNames = new Map(
    rows
      .filter((row) => (number(row.pk) ?? 0) > 0)
      .map((row) => [text(row.name), number(row.pk) ?? 0] as const),
  )
  const primaryColumns = columns
    .filter((column) => primaryNames.has(column.physicalName))
    .sort(
      (left, right) => primaryNames.get(left.physicalName)! - primaryNames.get(right.physicalName)!,
    )
  const constraints: CatalogConstraint[] = []

  if (primaryColumns.length > 0) {
    const primary: CatalogPrimaryKeyConstraint = {
      kind: "primary-key",
      id: stableId(`primary_${table.physicalName}`),
      identitySource: "deterministic-fallback",
      physicalName: `primary_${table.physicalName}`,
      columns: primaryColumns.map((column) => column.physicalName),
      dialect: sqliteExtension({ source: "pragma_table_xinfo" }),
      reference: reference(
        "constraint",
        `primary_${table.physicalName}`,
        namespace,
        "sqlite_schema",
        "tbl_name",
      ),
    }

    constraints.push(primary)
  }

  const checkExpressions = [
    ...(sqlText?.matchAll(/CHECK\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)/gi) ?? []),
  ]

  checkExpressions.forEach((match, index) => {
    const name = `check_${index}_${table.physicalName}`
    const check: CatalogCheckConstraint = {
      kind: "check",
      id: stableId(name),
      identitySource: "deterministic-fallback",
      physicalName: name,
      expression: sql(match[1] ?? "true", namespace, table, name),
      dialect: sqliteExtension({ source: "create-sql" }),
    }

    constraints.push(check)
  })
  return constraints
}

function sqliteIndex(
  table: CatalogTable,
  row: SqliteIndexListRow,
  infoRows: readonly SqliteIndexInfoRow[],
  sqlText: string | undefined,
  namespace: string,
  diagnostics: IntrospectionCatalog["diagnostics"][number][],
  opaqueObjects: CatalogOpaqueObject[],
): CatalogIndex | CatalogUniqueConstraint | undefined {
  const physicalName = text(row.name)

  if (!physicalName) {
    return undefined
  }

  const terms: CatalogIndexTerm[] = []
  const collations: string[] = []

  for (const info of infoRows.filter((item) => boolean(item.key))) {
    const position = number(info.seqno) ?? 0
    const cid = number(info.cid) ?? -1
    const collation = text(info.coll)

    if (collation) {
      collations.push(collation)
    }

    if (cid === -1) {
      continue
    }

    if (cid === -2) {
      const expressionText = indexExpressionFor(sqlText, position)

      if (expressionText) {
        terms.push({
          kind: "expression",
          expression: sql(expressionText, namespace, table, physicalName),
          position,
          direction: boolean(info.descending) ? "DESC" : "ASC",
        })
      } else {
        opaqueObjects.push(
          opaqueIndexExpression(table, physicalName, position, info, sqlText, namespace),
        )
        diagnostics.push(
          createIntrospectionDiagnostic({
            severity: "error",
            code: "unsupported-feature",
            message: `SQLite index ${physicalName} has an expression term that was not recovered`,
            path: [table.id, "indexes", physicalName, "terms", position],
            physicalReference: reference("index", physicalName, namespace, "sqlite_schema", "name"),
            remediation: "Preserve the CREATE INDEX SQL for expression terms.",
          }),
        )
      }

      continue
    }

    const columnName = text(info.name)

    if (cid >= 0 && columnName) {
      terms.push({
        kind: "column",
        column: columnName,
        position,
        direction: boolean(info.descending) ? "DESC" : "ASC",
      })
    } else {
      diagnostics.push(
        createIntrospectionDiagnostic({
          severity: "error",
          code: "unsupported-feature",
          message: `SQLite index ${physicalName} has an expression term that was not recovered`,
          path: [table.id, "indexes", physicalName, "terms", position],
          physicalReference: reference("index", physicalName, namespace, "sqlite_schema", "name"),
        }),
      )
    }
  }

  const unique = boolean(row.unique_index)

  if (text(row.origin) === "u") {
    const internalName = physicalName.startsWith("sqlite_autoindex_")
    const termNames = terms.map((term) =>
      term.kind === "column" ? term.column : `expression_${term.position}`,
    )
    const constraintName = internalName
      ? `unique_${table.physicalName}_${termNames.join("_") || "constraint"}`
      : physicalName
    const result: CatalogUniqueConstraint = {
      kind: "unique",
      id: stableId(constraintName),
      identitySource: internalName ? "deterministic-fallback" : "physical-name",
      physicalName: constraintName,
      columns: terms.flatMap((term) => (term.kind === "column" ? [term.column] : [])),
      nulls: "distinct",
      dialect: sqliteExtension({
        origin: text(row.origin) ?? "unknown",
        collations,
        ...(internalName ? { internalName } : {}),
      }),
      reference: reference(
        "constraint",
        constraintName,
        namespace,
        "pragma_index_list",
        "name",
        physicalName,
      ),
    }

    return result
  }

  return {
    kind: "index",
    id: stableId(physicalName),
    identitySource: "physical-name",
    physicalName,
    unique,
    terms,
    dialect: sqliteExtension({
      origin: text(row.origin) ?? "unknown",
      partial: boolean(row.partial),
      collations,
    }),
    predicate: boolean(row.partial)
      ? partialPredicate(sqlText, physicalName, namespace, table)
      : undefined,
    reference: reference("index", physicalName, namespace, "sqlite_schema", "name"),
  }
}

function foreignKeys(
  table: CatalogTable,
  rows: readonly SqliteForeignKeyRow[],
  namespace: string,
): readonly CatalogForeignKeyConstraint[] {
  const grouped = new Map<string, SqliteForeignKeyRow[]>()

  for (const row of rows) {
    const id = text(row.id) ?? "0"
    const group = grouped.get(id) ?? []

    group.push(row)
    grouped.set(id, group)
  }

  return [...grouped.entries()].map(([key, group]) => {
    const first = group[0]
    const physicalName = `foreign_key_${table.physicalName}_${key}`

    return {
      kind: "foreign-key",
      id: stableId(physicalName),
      identitySource: "deterministic-fallback",
      physicalName,
      columns: group
        .sort((left, right) => (number(left.seq) ?? 0) - (number(right.seq) ?? 0))
        .map((row) => text(row.source_column) ?? "unknown"),
      target: {
        table: text(first.target_table) ?? "unknown",
        columns: group.map((row) => text(row.target_column) ?? "unknown"),
      },
      onUpdate: action(first.on_update),
      onDelete: action(first.on_delete),
      match: match(first.match),
      dialect: sqliteExtension({ foreignKeyId: key }),
      reference: reference(
        "constraint",
        physicalName,
        namespace,
        "pragma_foreign_key_list",
        "id",
        key,
      ),
    }
  })
}

function partialPredicate(
  sqlText: string | undefined,
  indexName: string,
  namespace: string,
  table: CatalogTable,
) {
  const match = sqlText?.match(/\bWHERE\s+([\s\S]+)$/i)
  const predicate = match?.[1]?.trim().replace(/;\s*$/, "")

  return predicate ? sql(predicate, namespace, table, indexName) : undefined
}

function generatedExpressionFor(
  sqlText: string | undefined,
  columnName: string,
): string | undefined {
  if (!sqlText) {
    return undefined
  }

  const open = sqlText.indexOf("(")

  if (open < 0) {
    return undefined
  }

  const close = matchingParen(sqlText, open)

  if (close < 0) {
    return undefined
  }

  const definitions = splitSqlList(sqlText.slice(open + 1, close))

  for (const definition of definitions) {
    const identifier = definition
      .trim()
      .match(/^("(?:[^"]|"")*"|`[^`]*`|\[[^\]]*\]|[A-Za-z_][A-Za-z0-9_$]*)/)?.[1]

    if (unquoteIdentifier(identifier) !== columnName) {
      continue
    }

    const generated = definition.match(/\bAS\s*\(/i)

    if (!generated || generated.index === undefined) {
      return undefined
    }

    const generatedOpen = definition.indexOf("(", generated.index)

    if (generatedOpen < 0) {
      return undefined
    }

    const generatedClose = matchingParen(definition, generatedOpen)

    return generatedClose < 0
      ? undefined
      : definition.slice(generatedOpen + 1, generatedClose).trim()
  }

  return undefined
}

function sql(
  textValue: string,
  dialectNamespace: string,
  owner:
    | CatalogTable
    | CatalogView
    | {
        readonly kind: CatalogReference["kind"]
        readonly physicalName: string
        readonly reference?: CatalogReference
      },
  name: string,
): CatalogSqlExpression {
  const ownerReference =
    owner.reference ??
    reference(owner.kind, owner.physicalName, dialectNamespace, "sqlite_schema", "name")

  return {
    kind: "sql",
    dialect: "sqlite",
    text: textValue,
    provenance: {
      kind: "create-sql",
      dialect: "sqlite",
      reference: reference(
        ownerReference.kind,
        name,
        dialectNamespace,
        ownerReference.catalog?.relation ?? "sqlite_schema",
        ownerReference.catalog?.key ?? "name",
        ownerReference.catalog?.value ?? ownerReference.name,
      ),
    },
  }
}

function reference(
  kind: CatalogReference["kind"],
  name: string,
  namespace: string,
  relation: string,
  key: string,
  value: string | number = name,
): CatalogReference {
  return {
    kind,
    name,
    namespace,
    catalog: {
      relation,
      key,
      value,
    },
  }
}

function emptyCatalog(
  namespace: string,
  diagnostics: IntrospectionCatalog["diagnostics"],
): IntrospectionCatalog {
  return {
    dialect: "sqlite",
    server: {
      product: "sqlite",
      rawVersion: "unknown",
      capabilities: {
        generatedColumns: false,
        identityMetadata: false,
        checkConstraints: false,
        checkConstraintEnforcement: "unknown",
        expressionDecompilation: false,
        indexExpressions: false,
        indexPredicates: false,
        indexIncludedColumns: false,
        namespaces: false,
        visibility: "unknown",
      },
    },
    namespace: {
      kind: "sqlite-database",
      name: namespace,
    },
    tables: [],
    deferredObjects: [],
    diagnostics,
  }
}

function stableId(value: string): string {
  if (value && !/[.\\\u0000-\u001f\u007f]/.test(value)) {
    return value
  }

  let hash = 2166136261

  for (const character of value) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }

  return `introspected_${(hash >>> 0).toString(16)}`
}

function text(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : String(value)
}

function number(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }

  if (typeof value === "string" && value.trim() !== "") {
    const result = Number(value)

    return Number.isFinite(result) ? result : undefined
  }

  return undefined
}

function boolean(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "t" || value === "true"
}

function action(value: unknown): CatalogForeignKeyConstraint["onUpdate"] {
  const normalized = text(value)?.toLowerCase()

  return normalized === "cascade"
    ? "cascade"
    : normalized === "restrict"
      ? "restrict"
      : normalized === "set null"
        ? "set-null"
        : normalized === "set default"
          ? "set-default"
          : "no-action"
}

function match(value: unknown): CatalogForeignKeyConstraint["match"] {
  const normalized = text(value)?.toLowerCase()

  return normalized === "full" ? "full" : normalized === "partial" ? "partial" : "simple"
}
