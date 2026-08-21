import type { CatalogConnection } from './connection.ts'
import { createIntrospectionDiagnostic } from './diagnostics.ts'
import type {
  CatalogCheckConstraint,
  CatalogColumn,
  CatalogConstraint,
  CatalogDeferredObject,
  CatalogForeignKeyConstraint,
  CatalogIdentity,
  CatalogIndex,
  CatalogIndexTerm,
  CatalogPrimaryKeyConstraint,
  CatalogQueryRow,
  CatalogReference,
  CatalogServerInfo,
  CatalogTable,
  CatalogUniqueConstraint,
  IntrospectionCatalog,
  IntrospectionOptions,
} from './types.ts'

export const sqliteServerQuery = `SELECT sqlite_version() AS version, sqlite_source_id() AS source_id`
export const sqliteSchemaQuery = `
  SELECT type, name, tbl_name, sql
  FROM main.sqlite_schema
  WHERE name NOT LIKE 'sqlite_%'
  ORDER BY type, name
`
export const sqliteTableListQuery = `
  SELECT schema, name, type, ncol, wr, strict
  FROM pragma_table_list(?)
  ORDER BY name
`
export const sqliteTableInfoQuery = `
  SELECT cid, name, type, "notnull" AS not_null, dflt_value, pk, hidden
  FROM pragma_table_xinfo(?)
  ORDER BY cid
`
export const sqliteIndexListQuery = `
  SELECT seq, name, "unique" AS unique_index, origin, partial
  FROM pragma_index_list(?)
  ORDER BY seq
`
export const sqliteIndexInfoQuery = `
  SELECT seqno, cid, name, "desc" AS descending, coll, key
  FROM pragma_index_xinfo(?)
  ORDER BY seqno
`
export const sqliteForeignKeyQuery = `
  SELECT id, seq, "table" AS target_table, "from" AS source_column,
         "to" AS target_column, on_update, on_delete, match
  FROM pragma_foreign_key_list(?)
  ORDER BY id, seq
`

/** Read the selected SQLite database namespace into the normalized catalog. */
export async function readSqliteCatalog(
  connection: CatalogConnection,
  options: IntrospectionOptions
): Promise<IntrospectionCatalog> {
  const diagnostics = [] as IntrospectionCatalog['diagnostics'][number][]
  if (connection.dialect !== 'sqlite') {
    diagnostics.push(
      createIntrospectionDiagnostic({
        severity: 'error',
        code: 'dialect-mismatch',
        message: 'SQLite catalog reading requires a SQLite CatalogConnection',
        path: ['connection', 'dialect'],
      })
    )
    return emptyCatalog(options.namespace, diagnostics)
  }
  const serverRows = await query<SqliteServerRow>(
    connection,
    sqliteServerQuery,
    [],
    options,
    diagnostics,
    'server'
  )
  const server = serverInfo(serverRows[0], diagnostics)
  const schemaRows = await query<SqliteSchemaRow>(
    connection,
    sqliteSchemaQuery,
    [],
    options,
    diagnostics,
    'schema'
  )
  const tableRows = await query<SqliteTableListRow>(
    connection,
    sqliteTableListQuery,
    [options.namespace],
    options,
    diagnostics,
    'table-list'
  )
  const tableSql = new Map(
    schemaRows.map(row => [text(row.name), text(row.sql)])
  )
  const tables = tableRows
    .filter(row => text(row.type) === 'table')
    .map(row =>
      table(row, tableSql.get(text(row.name)) ?? undefined, options.namespace)
    )
  const deferredObjects = schemaRows
    .filter(row => text(row.type) !== 'table')
    .map(row => deferred(row, options.namespace))
  for (const currentTable of tables) {
    const tableName = currentTable.physicalName
    const rows = await query<SqliteColumnRow>(
      connection,
      sqliteTableInfoQuery,
      [tableName],
      options,
      diagnostics,
      `table-xinfo:${tableName}`
    )
    const sqlText = tableSql.get(tableName)
    const columns = rows
      .filter(row => number(row.hidden) !== 1)
      .map(row =>
        column(row, currentTable, options.namespace, sqlText, diagnostics)
      )
    ;(currentTable as Mutable<CatalogTable>).columns = columns
    ;(currentTable as Mutable<CatalogTable>).constraints = tableConstraints(
      currentTable,
      rows,
      columns,
      sqlText,
      options.namespace
    )
    const indexRows = await query<SqliteIndexListRow>(
      connection,
      sqliteIndexListQuery,
      [tableName],
      options,
      diagnostics,
      `index-list:${tableName}`
    )
    const mappedIndexes: CatalogIndex[] = []
    const mappedConstraints: CatalogConstraint[] = [
      ...(currentTable.constraints as readonly CatalogConstraint[]),
    ]
    for (const indexRow of indexRows) {
      const indexName = text(indexRow.name)
      if (!indexName || indexName.startsWith('sqlite_autoindex_')) continue
      const infoRows = await query<SqliteIndexInfoRow>(
        connection,
        sqliteIndexInfoQuery,
        [indexName],
        options,
        diagnostics,
        `index-info:${indexName}`
      )
      const index = sqliteIndex(
        currentTable,
        indexRow,
        infoRows,
        tableSql.get(indexName),
        options.namespace,
        diagnostics
      )
      if (!index) continue
      if (index.kind === 'index') mappedIndexes.push(index)
      else mappedConstraints.push(index)
    }
    const foreignRows = await query<SqliteForeignKeyRow>(
      connection,
      sqliteForeignKeyQuery,
      [tableName],
      options,
      diagnostics,
      `foreign-key:${tableName}`
    )
    mappedConstraints.push(
      ...foreignKeys(currentTable, foreignRows, options.namespace)
    )
    ;(currentTable as Mutable<CatalogTable>).indexes = mappedIndexes
    ;(currentTable as Mutable<CatalogTable>).constraints = mappedConstraints
  }
  return Object.freeze({
    dialect: 'sqlite' as const,
    server,
    namespace: {
      kind: 'sqlite-database' as const,
      name: options.namespace,
      reference: reference(
        'namespace',
        options.namespace,
        options.namespace,
        'sqlite_schema',
        'name'
      ),
    },
    tables: Object.freeze(tables),
    deferredObjects: Object.freeze(deferredObjects),
    diagnostics: Object.freeze(diagnostics),
  })
}

interface SqliteServerRow extends CatalogQueryRow {
  readonly version?: unknown
  readonly source_id?: unknown
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
  diagnostics: IntrospectionCatalog['diagnostics'][number][],
  operation: string
): Promise<readonly Row[]> {
  try {
    return await connection.query<Row>(
      { text: textValue, parameters },
      { signal: options.signal }
    )
  } catch {
    diagnostics.push(
      createIntrospectionDiagnostic({
        severity: 'error',
        code: 'query-failed',
        message: `SQLite catalog query failed while reading ${operation}`,
        path: [operation],
        remediation:
          'Check SQLite metadata visibility and the selected database.',
      })
    )
    return []
  }
}

function serverInfo(
  row: SqliteServerRow | undefined,
  diagnostics: IntrospectionCatalog['diagnostics'][number][]
): CatalogServerInfo {
  const rawVersion = text(row?.version) ?? 'unknown'
  const parts = rawVersion.split('.').map(item => Number(item))
  const supported = parts.length >= 2 && parts[0] === 3 && parts[1] >= 37
  if (!supported) {
    diagnostics.push(
      createIntrospectionDiagnostic({
        severity: 'error',
        code: 'unsupported-server',
        message: 'SQLite introspection requires SQLite 3.37 or newer',
        path: ['server', 'version'],
        remediation:
          'Use SQLite 3.37+ or provide a compatible adapter capability set.',
      })
    )
  }
  return {
    product: 'sqlite',
    rawVersion,
    parsedVersion: Number.isFinite(parts[0])
      ? { major: parts[0], minor: parts[1], patch: parts[2] }
      : undefined,
    capabilities: {
      generatedColumns: supported,
      identityMetadata: true,
      checkConstraints: true,
      checkConstraintEnforcement: 'enforced',
      expressionDecompilation: false,
      indexExpressions: true,
      indexPredicates: true,
      indexIncludedColumns: false,
      namespaces: false,
      visibility: 'complete',
      sourceIdAvailable: row?.source_id !== undefined,
    },
  }
}

function table(
  row: SqliteTableListRow,
  sqlText: string | undefined,
  namespace: string
): CatalogTable {
  const physicalName = text(row.name) ?? 'unnamed_table'
  return {
    kind: 'table',
    id: stableId(physicalName),
    identitySource: 'physical-name',
    physicalName,
    reference: reference(
      'table',
      physicalName,
      namespace,
      'sqlite_schema',
      'name'
    ),
    columns: [],
    constraints: [],
    indexes: [],
    unknownFields: [
      ...(boolean(row.wr)
        ? [{ name: 'withoutRowid', value: true as const }]
        : []),
      ...(boolean(row.strict)
        ? [{ name: 'strict', value: true as const }]
        : []),
      ...(sqlText ? [{ name: 'createSql', value: sqlText }] : []),
    ],
  }
}

function deferred(
  row: SqliteSchemaRow,
  namespace: string
): CatalogDeferredObject {
  const physicalName = text(row.name) ?? 'unnamed_object'
  const type = text(row.type)
  const objectKind =
    type === 'view' ? 'view' : type === 'trigger' ? 'trigger' : 'other'
  return {
    kind: 'deferred-object',
    objectKind,
    physicalName,
    reference: reference(
      'deferred-object',
      physicalName,
      namespace,
      'sqlite_schema',
      'name'
    ),
    unknownFields: row.sql
      ? [{ name: 'createSql', value: text(row.sql) as string }]
      : undefined,
  }
}

function column(
  row: SqliteColumnRow,
  table: CatalogTable,
  namespace: string,
  sqlText: string | undefined,
  diagnostics: IntrospectionCatalog['diagnostics'][number][]
): CatalogColumn {
  const physicalName = text(row.name) ?? 'unnamed_column'
  const hidden = number(row.hidden) ?? 0
  const type = text(row.type) ?? ''
  const defaultValue = text(row.dflt_value)
  const generatedExpression =
    hidden === 2 || hidden === 3
      ? generatedExpressionFor(sqlText, physicalName)
      : undefined
  if ((hidden === 2 || hidden === 3) && !generatedExpression) {
    diagnostics.push(
      createIntrospectionDiagnostic({
        severity: 'error',
        code: 'expression-parse-failed',
        message: `SQLite generated expression for ${physicalName} could not be recovered`,
        path: [table.id, 'columns', physicalName, 'generated'],
        remediation: 'Preserve the CREATE TABLE SQL or use lossy mode.',
      })
    )
  }
  const rowid =
    (number(row.pk) ?? 0) > 0 &&
    type.toUpperCase() === 'INTEGER' &&
    !/WITHOUT\s+ROWID/i.test(sqlText ?? '')
  const identity: CatalogIdentity | undefined = rowid
    ? {
        kind: 'identity',
        generation: 'by-default',
        options: {},
        dialect: {
          dialect: 'sqlite',
          version: 1,
          data: { autoIncrement: /AUTOINCREMENT/i.test(sqlText ?? '') },
        },
      }
    : undefined
  return {
    kind: 'column',
    id: stableId(physicalName),
    identitySource: 'physical-name',
    physicalName,
    ordinalPosition: number(row.cid) ?? 0,
    nullable: !boolean(row.not_null),
    storage: { nativeType: type || 'BLOB' },
    default:
      defaultValue && !generatedExpression
        ? {
            kind: 'expression',
            expression: sql(defaultValue, namespace, table, physicalName),
          }
        : undefined,
    generated: generatedExpression
      ? {
          kind: 'generated',
          mode: hidden === 2 ? 'virtual' : 'stored',
          expression: sql(generatedExpression, namespace, table, physicalName),
        }
      : undefined,
    identity,
    reference: reference(
      'column',
      physicalName,
      namespace,
      'pragma_table_xinfo',
      'name'
    ),
  }
}

function tableConstraints(
  table: CatalogTable,
  rows: readonly SqliteColumnRow[],
  columns: readonly CatalogColumn[],
  sqlText: string | undefined,
  namespace: string
): CatalogConstraint[] {
  const primaryNames = new Map(
    rows
      .filter(row => (number(row.pk) ?? 0) > 0)
      .map(row => [text(row.name), number(row.pk) ?? 0] as const)
  )
  const primaryColumns = columns
    .filter(column => primaryNames.has(column.physicalName))
    .sort(
      (left, right) =>
        primaryNames.get(left.physicalName)! -
        primaryNames.get(right.physicalName)!
    )
  const constraints: CatalogConstraint[] = []
  if (primaryColumns.length > 0) {
    const primary: CatalogPrimaryKeyConstraint = {
      kind: 'primary-key',
      id: stableId(`primary_${table.physicalName}`),
      identitySource: 'deterministic-fallback',
      physicalName: `primary_${table.physicalName}`,
      columns: primaryColumns.map(column => column.physicalName),
      reference: reference(
        'constraint',
        `primary_${table.physicalName}`,
        namespace,
        'sqlite_schema',
        'tbl_name'
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
      kind: 'check',
      id: stableId(name),
      identitySource: 'deterministic-fallback',
      physicalName: name,
      expression: sql(match[1] ?? 'true', namespace, table, name),
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
  diagnostics: IntrospectionCatalog['diagnostics'][number][]
): CatalogIndex | CatalogUniqueConstraint | undefined {
  const physicalName = text(row.name)
  if (!physicalName) return undefined
  const terms: CatalogIndexTerm[] = []
  for (const info of infoRows.filter(item => boolean(item.key))) {
    const position = number(info.seqno) ?? 0
    const cid = number(info.cid) ?? -1
    if (cid === -1) continue
    const columnName = text(info.name)
    if (cid >= 0 && columnName) {
      terms.push({
        kind: 'column',
        column: columnName,
        position,
        direction: boolean(info.descending) ? 'DESC' : 'ASC',
      })
    } else {
      diagnostics.push(
        createIntrospectionDiagnostic({
          severity: 'error',
          code: 'unsupported-feature',
          message: `SQLite index ${physicalName} has an expression term that was not recovered`,
          path: [table.id, 'indexes', physicalName],
        })
      )
    }
  }
  const unique = boolean(row.unique_index)
  if (text(row.origin) === 'u') {
    const result: CatalogUniqueConstraint = {
      kind: 'unique',
      id: stableId(physicalName),
      identitySource: 'physical-name',
      physicalName,
      columns: terms.flatMap(term =>
        term.kind === 'column' ? [term.column] : []
      ),
      nulls: 'distinct',
      reference: reference(
        'constraint',
        physicalName,
        namespace,
        'sqlite_schema',
        'name'
      ),
    }
    return result
  }
  return {
    kind: 'index',
    id: stableId(physicalName),
    identitySource: 'physical-name',
    physicalName,
    unique,
    terms,
    predicate: boolean(row.partial)
      ? partialPredicate(sqlText, physicalName, namespace, table)
      : undefined,
    reference: reference(
      'index',
      physicalName,
      namespace,
      'sqlite_schema',
      'name'
    ),
  }
}

function foreignKeys(
  table: CatalogTable,
  rows: readonly SqliteForeignKeyRow[],
  namespace: string
): readonly CatalogForeignKeyConstraint[] {
  const grouped = new Map<string, SqliteForeignKeyRow[]>()
  for (const row of rows) {
    const id = text(row.id) ?? '0'
    const group = grouped.get(id) ?? []
    group.push(row)
    grouped.set(id, group)
  }
  return [...grouped.entries()].map(([key, group]) => {
    const first = group[0]
    const physicalName = `foreign_key_${table.physicalName}_${key}`
    return {
      kind: 'foreign-key',
      id: stableId(physicalName),
      identitySource: 'deterministic-fallback',
      physicalName,
      columns: group
        .sort(
          (left, right) => (number(left.seq) ?? 0) - (number(right.seq) ?? 0)
        )
        .map(row => text(row.source_column) ?? 'unknown'),
      target: {
        table: text(first.target_table) ?? 'unknown',
        columns: group.map(row => text(row.target_column) ?? 'unknown'),
      },
      onUpdate: action(first.on_update),
      onDelete: action(first.on_delete),
      match: match(first.match),
      reference: reference(
        'constraint',
        physicalName,
        namespace,
        'pragma_foreign_key_list',
        'id',
        key
      ),
    }
  })
}

function partialPredicate(
  sqlText: string | undefined,
  indexName: string,
  namespace: string,
  table: CatalogTable
) {
  const match = sqlText?.match(
    new RegExp(
      `CREATE\\s+INDEX\\s+${escapeRegExp(indexName)}[\\s\\S]+?\\sWHERE\\s+([\\s\\S]+)$`,
      'i'
    )
  )
  return match?.[1] ? sql(match[1], namespace, table, indexName) : undefined
}

function generatedExpressionFor(
  sqlText: string | undefined,
  columnName: string
): string | undefined {
  if (!sqlText) return undefined
  const match = sqlText.match(
    new RegExp(
      `${escapeRegExp(columnName)}[^,]*?\\bAS\\s*\\(([^)]*)\\)\\s*(?:STORED|VIRTUAL)?`,
      'i'
    )
  )
  return match?.[1]?.trim()
}

function sql(
  textValue: string,
  dialectNamespace: string,
  table: CatalogTable,
  name: string
) {
  return {
    kind: 'sql' as const,
    dialect: 'sqlite' as const,
    text: textValue,
    provenance: {
      kind: 'create-sql' as const,
      dialect: 'sqlite' as const,
      reference: reference(
        'table',
        name,
        dialectNamespace,
        'sqlite_schema',
        'tbl_name',
        table.physicalName
      ),
    },
  }
}

function reference(
  kind: CatalogReference['kind'],
  name: string,
  namespace: string,
  relation: string,
  key: string,
  value: string | number = name
): CatalogReference {
  return { kind, name, namespace, catalog: { relation, key, value } }
}

function emptyCatalog(
  namespace: string,
  diagnostics: IntrospectionCatalog['diagnostics']
): IntrospectionCatalog {
  return {
    dialect: 'sqlite',
    server: {
      product: 'sqlite',
      rawVersion: 'unknown',
      capabilities: {
        generatedColumns: false,
        identityMetadata: false,
        checkConstraints: false,
        checkConstraintEnforcement: 'unknown',
        expressionDecompilation: false,
        indexExpressions: false,
        indexPredicates: false,
        indexIncludedColumns: false,
        namespaces: false,
        visibility: 'unknown',
      },
    },
    namespace: { kind: 'sqlite-database', name: namespace },
    tables: [],
    deferredObjects: [],
    diagnostics,
  }
}

function stableId(value: string): string {
  if (value && !/[.\\\u0000-\u001f\u007f]/.test(value)) return value
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
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const result = Number(value)
    return Number.isFinite(result) ? result : undefined
  }
  return undefined
}

function boolean(value: unknown): boolean {
  return (
    value === true ||
    value === 1 ||
    value === '1' ||
    value === 't' ||
    value === 'true'
  )
}

function action(value: unknown): CatalogForeignKeyConstraint['onUpdate'] {
  const normalized = text(value)?.toLowerCase()
  return normalized === 'cascade'
    ? 'cascade'
    : normalized === 'restrict'
      ? 'restrict'
      : normalized === 'set null'
        ? 'set-null'
        : normalized === 'set default'
          ? 'set-default'
          : 'no-action'
}

function match(value: unknown): CatalogForeignKeyConstraint['match'] {
  const normalized = text(value)?.toLowerCase()
  return normalized === 'full'
    ? 'full'
    : normalized === 'partial'
      ? 'partial'
      : 'simple'
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
