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
  CatalogScalar,
  CatalogPrimaryKeyConstraint,
  CatalogQueryRow,
  CatalogReference,
  CatalogServerInfo,
  CatalogTable,
  CatalogUniqueConstraint,
  IntrospectionCatalog,
  IntrospectionOptions,
} from './types.ts'

export const mysqlServerQuery = `SELECT VERSION() AS version, @@version_comment AS version_comment`
export const mysqlTablesQuery = `
  SELECT TABLE_NAME AS table_name, TABLE_TYPE AS table_type
  FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = ?
  ORDER BY TABLE_NAME
`
export const mysqlColumnsQuery = `
  SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name,
         ORDINAL_POSITION AS ordinal_position, COLUMN_TYPE AS column_type,
         DATA_TYPE AS data_type,
         IS_NULLABLE AS is_nullable, COLUMN_DEFAULT AS column_default,
         EXTRA AS extra, GENERATION_EXPRESSION AS generation_expression
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = ?
  ORDER BY TABLE_NAME, ORDINAL_POSITION
`
export const mysqlKeyUsageQuery = `
  SELECT kcu.TABLE_NAME AS table_name, kcu.CONSTRAINT_NAME AS constraint_name,
         tc.CONSTRAINT_TYPE AS constraint_type, tc.ENFORCED AS enforced,
         kcu.COLUMN_NAME AS column_name, kcu.ORDINAL_POSITION AS ordinal_position,
         kcu.REFERENCED_TABLE_NAME AS referenced_table_name,
         kcu.REFERENCED_COLUMN_NAME AS referenced_column_name,
         rc.UPDATE_RULE AS update_rule, rc.DELETE_RULE AS delete_rule,
         rc.MATCH_OPTION AS match_option
  FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
  JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
    ON tc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
   AND tc.TABLE_NAME = kcu.TABLE_NAME
   AND tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
  LEFT JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc
    ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
   AND rc.TABLE_NAME = kcu.TABLE_NAME
   AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
  WHERE kcu.CONSTRAINT_SCHEMA = ?
  ORDER BY kcu.TABLE_NAME, kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION
`
export const mysqlChecksQuery = `
  SELECT tc.TABLE_NAME AS table_name, tc.CONSTRAINT_NAME AS constraint_name,
         tc.ENFORCED AS enforced, cc.CHECK_CLAUSE AS check_clause
  FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
  JOIN INFORMATION_SCHEMA.CHECK_CONSTRAINTS cc
    ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
   AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
  WHERE tc.CONSTRAINT_SCHEMA = ? AND tc.CONSTRAINT_TYPE = 'CHECK'
  ORDER BY tc.TABLE_NAME, tc.CONSTRAINT_NAME
`
export const mysqlStatisticsQuery = `
  SELECT TABLE_NAME AS table_name, INDEX_NAME AS index_name,
         NON_UNIQUE AS non_unique, SEQ_IN_INDEX AS seq_in_index,
         COLUMN_NAME AS column_name, COLLATION AS collation,
         INDEX_TYPE AS index_type, EXPRESSION AS expression,
         SUB_PART AS sub_part
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = ?
  ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX
`

/** Read one MySQL database into the normalized catalog contract. */
export async function readMysqlCatalog(
  connection: CatalogConnection,
  options: IntrospectionOptions
): Promise<IntrospectionCatalog> {
  const diagnostics = [] as IntrospectionCatalog['diagnostics'][number][]
  if (connection.dialect !== 'mysql') {
    diagnostics.push(
      createIntrospectionDiagnostic({
        severity: 'error',
        code: 'dialect-mismatch',
        message: 'MySQL catalog reading requires a MySQL CatalogConnection',
        path: ['connection', 'dialect'],
      })
    )
    return emptyCatalog(options.namespace, diagnostics)
  }
  const serverRows = await query<MySqlServerRow>(
    connection,
    mysqlServerQuery,
    [],
    options,
    diagnostics,
    'server'
  )
  const server = serverInfo(serverRows[0], diagnostics)
  const tableRows = await query<MySqlTableRow>(
    connection,
    mysqlTablesQuery,
    [options.namespace],
    options,
    diagnostics,
    'tables'
  )
  const tables = tableRows
    .filter(row => text(row.table_type) === 'BASE TABLE')
    .map(row => table(row, options.namespace))
  const deferredObjects = tableRows
    .filter(row => text(row.table_type) !== 'BASE TABLE')
    .map(row => deferred(row, options.namespace))
  const tableByName = new Map(tables.map(item => [item.physicalName, item]))
  const columnRows = await query<MySqlColumnRow>(
    connection,
    mysqlColumnsQuery,
    [options.namespace],
    options,
    diagnostics,
    'columns'
  )
  for (const currentTable of tables) {
    const rows = columnRows.filter(
      row => text(row.table_name) === currentTable.physicalName
    )
    ;(currentTable as Mutable<CatalogTable>).columns = rows.map(row =>
      column(row, currentTable, options.namespace)
    )
  }
  const keyRows = await query<MySqlKeyRow>(
    connection,
    mysqlKeyUsageQuery,
    [options.namespace],
    options,
    diagnostics,
    'constraints'
  )
  for (const currentTable of tables) {
    const rows = keyRows.filter(
      row => text(row.table_name) === currentTable.physicalName
    )
    ;(currentTable as Mutable<CatalogTable>).constraints = constraints(
      currentTable,
      rows,
      tableByName,
      options.namespace,
      diagnostics
    )
  }
  const checkRows = await query<MySqlCheckRow>(
    connection,
    mysqlChecksQuery,
    [options.namespace],
    options,
    diagnostics,
    'checks'
  )
  const constraintsByTable = new Map<string, CatalogConstraint[]>()
  for (const currentTable of tables) {
    constraintsByTable.set(currentTable.physicalName, [
      ...(currentTable.constraints as readonly CatalogConstraint[]),
    ])
  }
  for (const row of checkRows) {
    const currentTable = tableByName.get(text(row.table_name) ?? '')
    if (!currentTable) continue
    const physicalName =
      text(row.constraint_name) ?? `check_${currentTable.physicalName}`
    const check: CatalogCheckConstraint = {
      kind: 'check',
      id: stableId(physicalName),
      identitySource: 'physical-name',
      physicalName,
      expression: sql(
        text(row.check_clause) ?? 'true',
        options.namespace,
        currentTable,
        physicalName
      ),
      dialect:
        text(row.enforced)?.toUpperCase() === 'NO'
          ? { dialect: 'mysql', version: 1, data: { enforced: false } }
          : undefined,
    }
    constraintsByTable.get(currentTable.physicalName)?.push(check)
  }
  for (const currentTable of tables) {
    ;(currentTable as Mutable<CatalogTable>).constraints =
      constraintsByTable.get(currentTable.physicalName) ?? []
  }
  const statRows = await query<MySqlStatisticsRow>(
    connection,
    mysqlStatisticsQuery,
    [options.namespace],
    options,
    diagnostics,
    'statistics'
  )
  const grouped = new Map<string, MySqlStatisticsRow[]>()
  for (const row of statRows) {
    const key = `${text(row.table_name) ?? ''}\u0000${text(row.index_name) ?? ''}`
    const group = grouped.get(key) ?? []
    group.push(row)
    grouped.set(key, group)
  }
  for (const rows of grouped.values()) {
    const currentTable = tableByName.get(text(rows[0].table_name) ?? '')
    if (!currentTable) continue
    const mappedIndex = mapIndex(
      rows,
      currentTable,
      options.namespace,
      diagnostics
    )
    if (mappedIndex) {
      ;(currentTable as Mutable<CatalogTable>).indexes = [
        ...(currentTable.indexes as readonly CatalogIndex[]),
        mappedIndex,
      ]
    }
  }
  return Object.freeze({
    dialect: 'mysql' as const,
    server,
    namespace: {
      kind: 'mysql-database' as const,
      name: options.namespace,
      reference: reference(
        'namespace',
        options.namespace,
        options.namespace,
        'INFORMATION_SCHEMA.SCHEMATA',
        'SCHEMA_NAME'
      ),
    },
    tables: Object.freeze(tables),
    deferredObjects: Object.freeze(deferredObjects),
    diagnostics: Object.freeze(diagnostics),
  })
}

interface MySqlServerRow extends CatalogQueryRow {
  readonly version?: unknown
  readonly version_comment?: unknown
}
interface MySqlTableRow extends CatalogQueryRow {
  readonly table_name?: unknown
  readonly table_type?: unknown
}
interface MySqlColumnRow extends CatalogQueryRow {
  readonly table_name?: unknown
  readonly column_name?: unknown
  readonly ordinal_position?: unknown
  readonly column_type?: unknown
  readonly data_type?: unknown
  readonly is_nullable?: unknown
  readonly column_default?: unknown
  readonly extra?: unknown
  readonly generation_expression?: unknown
}
interface MySqlKeyRow extends CatalogQueryRow {
  readonly table_name?: unknown
  readonly constraint_name?: unknown
  readonly constraint_type?: unknown
  readonly enforced?: unknown
  readonly column_name?: unknown
  readonly ordinal_position?: unknown
  readonly referenced_table_name?: unknown
  readonly referenced_column_name?: unknown
  readonly update_rule?: unknown
  readonly delete_rule?: unknown
  readonly match_option?: unknown
}
interface MySqlCheckRow extends CatalogQueryRow {
  readonly table_name?: unknown
  readonly constraint_name?: unknown
  readonly enforced?: unknown
  readonly check_clause?: unknown
}
interface MySqlStatisticsRow extends CatalogQueryRow {
  readonly table_name?: unknown
  readonly index_name?: unknown
  readonly non_unique?: unknown
  readonly seq_in_index?: unknown
  readonly column_name?: unknown
  readonly collation?: unknown
  readonly index_type?: unknown
  readonly expression?: unknown
  readonly sub_part?: unknown
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
        message: `MySQL catalog query failed while reading ${operation}`,
        path: [operation],
        remediation:
          'Check Information Schema permissions and the selected database.',
      })
    )
    return []
  }
}

function serverInfo(
  row: MySqlServerRow | undefined,
  diagnostics: IntrospectionCatalog['diagnostics'][number][]
): CatalogServerInfo {
  const rawVersion = text(row?.version) ?? 'unknown'
  const comment = text(row?.version_comment) ?? ''
  const mariadb = /mariadb/i.test(rawVersion) || /mariadb/i.test(comment)
  const parts = rawVersion.match(/(\d+)\.(\d+)(?:\.(\d+))?/)
  const major = parts ? Number(parts[1]) : undefined
  const minor = parts ? Number(parts[2]) : undefined
  if (mariadb) {
    diagnostics.push(
      createIntrospectionDiagnostic({
        severity: 'error',
        code: 'unsupported-product',
        message:
          'MariaDB requires a dedicated catalog adapter and is not treated as MySQL',
        path: ['server', 'product'],
      })
    )
  }
  const supported =
    !mariadb &&
    major !== undefined &&
    (major > 8 ||
      (major === 8 && (minor ?? 0) > 0) ||
      (major === 8 && minor === 0 && Number(parts?.[3] ?? 0) >= 16))
  if (!supported && !mariadb) {
    diagnostics.push(
      createIntrospectionDiagnostic({
        severity: 'error',
        code: 'unsupported-server',
        message: 'MySQL introspection requires MySQL 8.0 or newer',
        path: ['server', 'version'],
      })
    )
  }
  return {
    product: mariadb ? 'mariadb' : 'mysql',
    rawVersion,
    parsedVersion:
      major === undefined
        ? undefined
        : { major, minor, patch: parts?.[3] ? Number(parts[3]) : undefined },
    capabilities: {
      generatedColumns: supported,
      identityMetadata: supported,
      checkConstraints: supported,
      checkConstraintEnforcement: supported ? 'enforced' : 'unknown',
      expressionDecompilation: false,
      indexExpressions: true,
      indexPredicates: false,
      indexIncludedColumns: false,
      namespaces: true,
      visibility: 'complete',
    },
  }
}

function table(row: MySqlTableRow, namespace: string): CatalogTable {
  const physicalName = text(row.table_name) ?? 'unnamed_table'
  return {
    kind: 'table',
    id: stableId(physicalName),
    identitySource: 'physical-name',
    physicalName,
    reference: reference(
      'table',
      physicalName,
      namespace,
      'INFORMATION_SCHEMA.TABLES',
      'TABLE_NAME'
    ),
    columns: [],
    constraints: [],
    indexes: [],
  }
}

function deferred(
  row: MySqlTableRow,
  namespace: string
): CatalogDeferredObject {
  const physicalName = text(row.table_name) ?? 'unnamed_object'
  return {
    kind: 'deferred-object',
    objectKind: text(row.table_type) === 'VIEW' ? 'view' : 'other',
    physicalName,
    reference: reference(
      'deferred-object',
      physicalName,
      namespace,
      'INFORMATION_SCHEMA.TABLES',
      'TABLE_NAME'
    ),
  }
}

function column(
  row: MySqlColumnRow,
  table: CatalogTable,
  namespace: string
): CatalogColumn {
  const physicalName = text(row.column_name) ?? 'unnamed_column'
  const extra = text(row.extra) ?? ''
  const generationExpression = text(row.generation_expression)
  const generated =
    /GENERATED/i.test(extra) && generationExpression
      ? {
          kind: 'generated' as const,
          mode: /VIRTUAL/i.test(extra)
            ? ('virtual' as const)
            : ('stored' as const),
          expression: sql(generationExpression, namespace, table, physicalName),
        }
      : undefined
  const identity: CatalogIdentity | undefined = /auto_increment/i.test(extra)
    ? {
        kind: 'identity',
        generation: 'by-default',
        options: {},
        dialect: {
          dialect: 'mysql',
          version: 1,
          data: { autoIncrement: true },
        },
      }
    : undefined
  const onUpdateMatch = extra.match(/on update\s+(.+)$/i)
  const defaultText = text(row.column_default)
  const defaultValue = literal(defaultText, text(row.data_type))
  return {
    kind: 'column',
    id: stableId(physicalName),
    identitySource: 'physical-name',
    physicalName,
    ordinalPosition: number(row.ordinal_position) ?? 0,
    nullable: text(row.is_nullable)?.toUpperCase() !== 'NO',
    storage: { nativeType: text(row.column_type) ?? 'unknown' },
    default:
      defaultValue !== undefined
        ? { kind: 'literal', value: defaultValue }
        : defaultText !== undefined
          ? {
              kind: 'expression',
              expression: sql(defaultText, namespace, table, physicalName),
            }
          : undefined,
    generated,
    identity,
    onUpdate: onUpdateMatch?.[1]
      ? sql(onUpdateMatch[1], namespace, table, physicalName)
      : undefined,
    reference: reference(
      'column',
      physicalName,
      namespace,
      'INFORMATION_SCHEMA.COLUMNS',
      'COLUMN_NAME'
    ),
  }
}

function constraints(
  table: CatalogTable,
  rows: readonly MySqlKeyRow[],
  tableByName: ReadonlyMap<string, CatalogTable>,
  namespace: string,
  diagnostics: IntrospectionCatalog['diagnostics'][number][]
): CatalogConstraint[] {
  const grouped = new Map<string, MySqlKeyRow[]>()
  for (const row of rows) {
    const key = text(row.constraint_name) ?? 'unknown'
    const group = grouped.get(key) ?? []
    group.push(row)
    grouped.set(key, group)
  }
  const result: CatalogConstraint[] = []
  for (const [physicalName, group] of grouped) {
    const first = group[0]
    const columns = group
      .sort(
        (left, right) =>
          (number(left.ordinal_position) ?? 0) -
          (number(right.ordinal_position) ?? 0)
      )
      .map(row => text(row.column_name) ?? 'unknown')
    const common = {
      id: stableId(physicalName),
      identitySource: 'physical-name' as const,
      physicalName,
      reference: reference(
        'constraint',
        physicalName,
        namespace,
        'INFORMATION_SCHEMA.TABLE_CONSTRAINTS',
        'CONSTRAINT_NAME'
      ),
    }
    const type = text(first.constraint_type)
    if (type === 'PRIMARY KEY') {
      result.push({
        kind: 'primary-key',
        ...common,
        columns,
      } satisfies CatalogPrimaryKeyConstraint)
      continue
    }
    if (type === 'UNIQUE') {
      result.push({
        kind: 'unique',
        ...common,
        columns,
        nulls: 'distinct',
      } satisfies CatalogUniqueConstraint)
      continue
    }
    if (type !== 'FOREIGN KEY') continue
    const targetTableName = text(first.referenced_table_name) ?? 'unknown'
    if (!tableByName.has(targetTableName)) {
      diagnostics.push(
        createIntrospectionDiagnostic({
          severity: 'error',
          code: 'unresolved-reference',
          message: `MySQL foreign key target ${targetTableName} was not found`,
          path: [table.id, 'constraints', physicalName],
        })
      )
    }
    result.push({
      kind: 'foreign-key',
      ...common,
      columns,
      target: {
        table: targetTableName,
        columns: group.map(
          row => text(row.referenced_column_name) ?? 'unknown'
        ),
      },
      onUpdate: action(first.update_rule),
      onDelete: action(first.delete_rule),
      match: match(first.match_option),
      dialect:
        text(first.enforced)?.toUpperCase() === 'NO'
          ? { dialect: 'mysql', version: 1, data: { enforced: false } }
          : undefined,
    } satisfies CatalogForeignKeyConstraint)
  }
  return result
}

function mapIndex(
  rows: readonly MySqlStatisticsRow[],
  table: CatalogTable,
  namespace: string,
  diagnostics: IntrospectionCatalog['diagnostics'][number][]
): CatalogIndex | undefined {
  const first = rows[0]
  const physicalName = text(first.index_name)
  if (!physicalName) return undefined
  const terms: CatalogIndexTerm[] = []
  for (const row of rows) {
    const expression = text(row.expression)
    const columnName = text(row.column_name)
    if (!expression && !columnName) {
      diagnostics.push(
        createIntrospectionDiagnostic({
          severity: 'error',
          code: 'unsupported-feature',
          message: `MySQL index ${physicalName} has an unrepresented term`,
          path: [table.id, 'indexes', physicalName],
        })
      )
      continue
    }
    terms.push(
      expression
        ? {
            kind: 'expression',
            expression: sql(expression, namespace, table, physicalName),
            position: number(row.seq_in_index) ?? 0,
          }
        : {
            kind: 'column',
            column: columnName as string,
            position: number(row.seq_in_index) ?? 0,
            direction: text(row.collation) === 'D' ? 'DESC' : 'ASC',
            prefixLength:
              row.sub_part === null || row.sub_part === undefined
                ? undefined
                : {
                    kind: 'literal',
                    value: number(row.sub_part) ?? text(row.sub_part) ?? '',
                  },
          }
    )
    if (row.sub_part !== null && row.sub_part !== undefined) {
      diagnostics.push(
        createIntrospectionDiagnostic({
          severity: 'warning',
          code: 'lossy-mapping',
          message: `MySQL index prefix length for ${physicalName} is retained only in catalog rows`,
          path: [table.id, 'indexes', physicalName],
        })
      )
    }
  }
  return {
    kind: 'index',
    id: stableId(physicalName),
    identitySource: 'physical-name',
    physicalName,
    unique: number(first.non_unique) === 0,
    terms,
    method: text(first.index_type),
    dialect: text(first.index_type)
      ? {
          dialect: 'mysql',
          version: 1,
          data: { indexType: text(first.index_type) as string },
        }
      : undefined,
    reference: reference(
      'index',
      physicalName,
      namespace,
      'INFORMATION_SCHEMA.STATISTICS',
      'INDEX_NAME'
    ),
  }
}

function sql(
  textValue: string,
  namespace: string,
  table: CatalogTable,
  name: string
) {
  return {
    kind: 'sql' as const,
    dialect: 'mysql' as const,
    text: textValue,
    provenance: {
      kind: 'catalog' as const,
      dialect: 'mysql' as const,
      reference: reference(
        'table',
        name,
        namespace,
        'INFORMATION_SCHEMA',
        'TABLE_NAME',
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

function literal(
  value: string | undefined,
  dataType?: string
): CatalogScalar | undefined {
  if (value === undefined) return undefined
  if (value.toUpperCase() === 'NULL') return null
  if (value.toUpperCase() === 'TRUE') return true
  if (value.toUpperCase() === 'FALSE') return false
  if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(value)) return Number(value)
  if (/^'(?:''|[^'])*'$/.test(value))
    return value.slice(1, -1).replace(/''/g, "'")
  if (
    value === '' ||
    /^(?:char|varchar|text|tinytext|mediumtext|longtext|enum|set)$/i.test(
      dataType ?? ''
    )
  )
    return value
  return undefined
}

function emptyCatalog(
  namespace: string,
  diagnostics: IntrospectionCatalog['diagnostics']
): IntrospectionCatalog {
  return {
    dialect: 'mysql',
    server: {
      product: 'mysql',
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
        namespaces: true,
        visibility: 'unknown',
      },
    },
    namespace: { kind: 'mysql-database', name: namespace },
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
  return text(value)?.toLowerCase() === 'full' ? 'full' : 'simple'
}
