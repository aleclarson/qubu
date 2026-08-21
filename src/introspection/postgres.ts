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

/** Fixed server metadata query used by the PostgreSQL catalog reader. */
export const postgresServerQuery = `
  SELECT
    current_setting('server_version_num') AS server_version_num,
    current_setting('server_version') AS server_version
`

/** Read one PostgreSQL schema into the normalized catalog contract. */
export async function readPostgresCatalog(
  connection: CatalogConnection,
  options: IntrospectionOptions
): Promise<IntrospectionCatalog> {
  const diagnostics = [] as IntrospectionCatalog['diagnostics'][number][]
  if (connection.dialect !== 'postgresql') {
    diagnostics.push(
      createIntrospectionDiagnostic({
        severity: 'error',
        code: 'dialect-mismatch',
        message: `PostgreSQL catalog reader received a ${connection.dialect} connection`,
        path: ['connection', 'dialect'],
        remediation: 'Use a PostgreSQL CatalogConnection with this reader.',
      })
    )
    return emptyCatalog(options.namespace, diagnostics)
  }
  const serverRows = await query<PostgresServerRow>(
    connection,
    postgresServerQuery,
    [],
    options,
    diagnostics,
    'server'
  )
  const server = serverInfo(serverRows[0], diagnostics)
  const relationRows = await query<PostgresRelationRow>(
    connection,
    postgresRelationsQuery,
    [options.namespace],
    options,
    diagnostics,
    'relations'
  )
  const tables = relationRows
    .filter(row => row.relkind === 'r' || row.relkind === 'p')
    .map(row => relationTable(row))
  const deferredObjects = relationRows
    .filter(row => row.relkind !== 'r' && row.relkind !== 'p')
    .map(row => deferredObject(row))
  const tableByOid = new Map(
    tables.map(table => [table.reference?.catalog?.value, table])
  )

  const columnRows = await query<PostgresColumnRow>(
    connection,
    postgresColumnsQuery,
    [options.namespace],
    options,
    diagnostics,
    'columns'
  )
  const columnsByTable = groupBy(columnRows, row => row.table_oid)
  for (const table of tables) {
    const rows = columnsByTable.get(table.reference?.catalog?.value) ?? []
    const columns = rows
      .sort(
        (left, right) =>
          (number(left.ordinal_position) ?? 0) -
          (number(right.ordinal_position) ?? 0)
      )
      .map(row => column(row, table, options.namespace))
    ;(table as Mutable<CatalogTable>).columns = columns
  }

  const constraintRows = await query<PostgresConstraintRow>(
    connection,
    postgresConstraintsQuery,
    [options.namespace],
    options,
    diagnostics,
    'constraints'
  )
  const constraintsByTable = groupBy(constraintRows, row => row.table_oid)
  for (const table of tables) {
    const rows = constraintsByTable.get(table.reference?.catalog?.value) ?? []
    const columnsByNumber = new Map(
      (table.columns as readonly CatalogColumn[]).map((column, index) => [
        index + 1,
        column.physicalName,
      ])
    )
    const constraints = rows
      .map(row =>
        constraint(
          row,
          table,
          columnsByNumber,
          tableByOid,
          options.namespace,
          diagnostics
        )
      )
      .filter((value): value is CatalogConstraint => value !== undefined)
    ;(table as Mutable<CatalogTable>).constraints = constraints
  }

  const indexRows = await query<PostgresIndexRow>(
    connection,
    postgresIndexesQuery,
    [options.namespace],
    options,
    diagnostics,
    'indexes'
  )
  const indexesByTable = groupBy(indexRows, row => row.table_oid)
  for (const table of tables) {
    const rows = indexesByTable.get(table.reference?.catalog?.value) ?? []
    const columnsByNumber = new Map(
      (table.columns as readonly CatalogColumn[]).map((column, index) => [
        index + 1,
        column.physicalName,
      ])
    )
    const mappedIndexes = mapIndexes(
      rows,
      table,
      columnsByNumber,
      options.namespace
    )
    ;(table as Mutable<CatalogTable>).indexes = mappedIndexes
  }

  return Object.freeze({
    dialect: 'postgresql',
    server,
    namespace: {
      kind: 'postgres-schema' as const,
      name: options.namespace,
      reference: reference(
        'namespace',
        options.namespace,
        options.namespace,
        'pg_namespace',
        'nspname'
      ),
    },
    tables: Object.freeze(tables),
    deferredObjects: Object.freeze(deferredObjects),
    diagnostics: Object.freeze(diagnostics),
  })
}

export const postgresRelationsQuery = `
  SELECT c.oid::text AS oid, n.nspname AS namespace, c.relname,
         c.relkind, c.relispartition
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = $1
    AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
  ORDER BY c.relname
`

export const postgresColumnsQuery = `
  SELECT a.attrelid::text AS table_oid, a.attnum::int AS ordinal_position,
         a.attname AS physical_name, NOT a.attnotnull AS nullable,
         format_type(a.atttypid, a.atttypmod) AS native_type,
         a.attidentity, a.attgenerated,
         pg_get_expr(ad.adbin, ad.adrelid) AS default_expression
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
  WHERE n.nspname = $1
    AND c.relkind IN ('r', 'p')
    AND a.attnum > 0
    AND NOT a.attisdropped
  ORDER BY a.attrelid, a.attnum
`

export const postgresConstraintsQuery = `
  SELECT con.oid::text AS oid, con.conrelid::text AS table_oid,
         con.conname AS physical_name, con.contype,
         con.conkey, con.confrelid::text AS target_table_oid, con.confkey,
         con.confupdtype, con.confdeltype, con.confmatchtype,
         con.condeferrable, con.condeferred, con.convalidated,
         i.indnullsnotdistinct,
         pg_get_constraintdef(con.oid, true) AS definition
  FROM pg_constraint con
  JOIN pg_class c ON c.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_index i ON i.indexrelid = con.conindid
  WHERE n.nspname = $1
    AND con.contype IN ('p', 'u', 'f', 'c')
  ORDER BY con.conrelid, con.oid
`

export const postgresIndexesQuery = `
  SELECT i.indexrelid::text AS index_oid, i.indrelid::text AS table_oid,
         c.relname AS physical_name, i.indisunique, i.indnkeyatts::int,
         i.indnatts::int, am.amname AS method,
         pg_get_expr(i.indpred, i.indrelid, true) AS predicate,
         s.position::int,
         (i.indkey[s.position])::int AS attnum,
         (i.indoption[s.position])::int AS indoption,
         pg_get_indexdef(i.indexrelid, s.position, true) AS term_definition
  FROM pg_index i
  JOIN pg_class c ON c.oid = i.indexrelid
  JOIN pg_class t ON t.oid = i.indrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  JOIN pg_am am ON am.oid = c.relam
  CROSS JOIN LATERAL generate_series(1, i.indnatts) AS s(position)
  WHERE n.nspname = $1
  ORDER BY i.indrelid, i.indexrelid, s.position
`

interface PostgresServerRow extends CatalogQueryRow {
  readonly server_version_num?: unknown
  readonly server_version?: unknown
}

interface PostgresRelationRow extends CatalogQueryRow {
  readonly oid?: unknown
  readonly namespace?: unknown
  readonly relname?: unknown
  readonly relkind?: unknown
  readonly relispartition?: unknown
}

interface PostgresColumnRow extends CatalogQueryRow {
  readonly table_oid?: unknown
  readonly ordinal_position?: unknown
  readonly physical_name?: unknown
  readonly nullable?: unknown
  readonly native_type?: unknown
  readonly attidentity?: unknown
  readonly attgenerated?: unknown
  readonly default_expression?: unknown
}

interface PostgresConstraintRow extends CatalogQueryRow {
  readonly oid?: unknown
  readonly table_oid?: unknown
  readonly physical_name?: unknown
  readonly contype?: unknown
  readonly conkey?: unknown
  readonly target_table_oid?: unknown
  readonly confkey?: unknown
  readonly confupdtype?: unknown
  readonly confdeltype?: unknown
  readonly confmatchtype?: unknown
  readonly condeferrable?: unknown
  readonly condeferred?: unknown
  readonly convalidated?: unknown
  readonly indnullsnotdistinct?: unknown
  readonly definition?: unknown
}

interface PostgresIndexRow extends CatalogQueryRow {
  readonly index_oid?: unknown
  readonly table_oid?: unknown
  readonly physical_name?: unknown
  readonly indisunique?: unknown
  readonly indnkeyatts?: unknown
  readonly indnatts?: unknown
  readonly method?: unknown
  readonly predicate?: unknown
  readonly position?: unknown
  readonly attnum?: unknown
  readonly indoption?: unknown
  readonly term_definition?: unknown
}

type Mutable<T> = { -readonly [Key in keyof T]: T[Key] }

async function query<Row extends Readonly<Record<string, unknown>>>(
  connection: CatalogConnection,
  text: string,
  parameters: readonly unknown[],
  options: IntrospectionOptions,
  diagnostics: IntrospectionCatalog['diagnostics'][number][],
  operation: string
): Promise<readonly Row[]> {
  try {
    return await connection.query<Row>(
      { text, parameters },
      { signal: options.signal }
    )
  } catch {
    diagnostics.push(
      createIntrospectionDiagnostic({
        severity: 'error',
        code: 'query-failed',
        message: `PostgreSQL catalog query failed while reading ${operation}`,
        path: [operation],
        remediation: 'Check PostgreSQL permissions and the selected schema.',
      })
    )
    return []
  }
}

function serverInfo(
  row: PostgresServerRow | undefined,
  diagnostics: IntrospectionCatalog['diagnostics'][number][]
): CatalogServerInfo {
  const rawVersion = text(row?.server_version) ?? 'unknown'
  const numericVersion = number(row?.server_version_num)
  if (!row) {
    diagnostics.push(
      createIntrospectionDiagnostic({
        severity: 'error',
        code: 'unsupported-server',
        message: 'PostgreSQL server version metadata was unavailable',
        path: ['server'],
        remediation: 'Provide access to current_setting(server_version_num).',
      })
    )
  }
  const major = numericVersion ? Math.floor(numericVersion / 10000) : undefined
  const supported = major !== undefined && major >= 12
  if (!supported) {
    diagnostics.push(
      createIntrospectionDiagnostic({
        severity: 'error',
        code: 'unsupported-server',
        message: 'PostgreSQL introspection requires server version 12 or newer',
        path: ['server', 'version'],
        remediation: 'Use PostgreSQL 12+ or an adapter capability extension.',
      })
    )
  }
  return {
    product: 'postgresql',
    rawVersion,
    parsedVersion: major === undefined ? undefined : { major },
    capabilities: {
      generatedColumns: supported,
      identityMetadata:
        numericVersion !== undefined && numericVersion >= 100000,
      checkConstraints: true,
      checkConstraintEnforcement: 'enforced',
      expressionDecompilation: true,
      indexExpressions: true,
      indexPredicates: true,
      indexIncludedColumns: true,
      namespaces: true,
      visibility: 'complete',
    },
  }
}

function emptyCatalog(
  namespace: string,
  diagnostics: IntrospectionCatalog['diagnostics'][number][]
): IntrospectionCatalog {
  return {
    dialect: 'postgresql',
    server: {
      product: 'postgresql',
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
    namespace: { kind: 'postgres-schema', name: namespace },
    tables: [],
    deferredObjects: [],
    diagnostics: Object.freeze(diagnostics),
  }
}

function relationTable(row: PostgresRelationRow): CatalogTable {
  const physicalName = text(row.relname) ?? 'unnamed_table'
  return {
    kind: 'table',
    id: stableId(physicalName),
    identitySource: 'physical-name',
    physicalName,
    reference: reference(
      'table',
      physicalName,
      text(row.namespace),
      'pg_class',
      'oid',
      row.oid
    ),
    columns: [],
    constraints: [],
    indexes: [],
    unknownFields:
      row.relispartition === true
        ? [{ name: 'partitioned', value: true }]
        : undefined,
  }
}

function deferredObject(row: PostgresRelationRow): CatalogDeferredObject {
  const physicalName = text(row.relname) ?? 'unnamed_object'
  const objectKind =
    row.relkind === 'v'
      ? 'view'
      : row.relkind === 'm'
        ? 'materialized-view'
        : row.relkind === 'S'
          ? 'sequence'
          : 'other'
  return {
    kind: 'deferred-object',
    objectKind,
    physicalName,
    reference: reference(
      'deferred-object',
      physicalName,
      text(row.namespace),
      'pg_class',
      'oid',
      row.oid
    ),
  }
}

function column(
  row: PostgresColumnRow,
  table: CatalogTable,
  namespace: string
): CatalogColumn {
  const physicalName = text(row.physical_name) ?? 'unnamed_column'
  const defaultExpression = text(row.default_expression)
  const identityValue = text(row.attidentity)
  const generatedValue = text(row.attgenerated)
  const identity: CatalogIdentity | undefined =
    identityValue === 'a' || identityValue === 'd'
      ? {
          kind: 'identity',
          generation: identityValue === 'a' ? 'always' : 'by-default',
          options: {},
        }
      : undefined
  return {
    kind: 'column',
    id: stableId(physicalName),
    identitySource: 'physical-name',
    physicalName,
    ordinalPosition: number(row.ordinal_position) ?? 0,
    nullable: boolean(row.nullable),
    storage: { nativeType: text(row.native_type) ?? 'unknown' },
    default:
      defaultExpression && !identity
        ? {
            kind: 'expression',
            expression: sql(defaultExpression, namespace, table, physicalName),
          }
        : undefined,
    generated:
      generatedValue === 's' && defaultExpression
        ? {
            kind: 'generated',
            mode: 'stored',
            expression: sql(defaultExpression, namespace, table, physicalName),
          }
        : undefined,
    identity,
    reference: reference(
      'column',
      physicalName,
      namespace,
      'pg_attribute',
      'attrelid',
      row.table_oid
    ),
  }
}

function constraint(
  row: PostgresConstraintRow,
  table: CatalogTable,
  columnsByNumber: ReadonlyMap<number, string>,
  tableByOid: ReadonlyMap<string | number | undefined, CatalogTable>,
  namespace: string,
  diagnostics: IntrospectionCatalog['diagnostics'][number][]
): CatalogConstraint | undefined {
  const kind = text(row.contype)
  const physicalName =
    text(row.physical_name) ?? `constraint_${text(row.oid) ?? 'unknown'}`
  const numbers = integerArray(row.conkey)
  const columns = numbers.map(
    numberValue => columnsByNumber.get(numberValue) ?? `attnum_${numberValue}`
  )
  const common = {
    id: stableId(physicalName),
    identitySource: 'physical-name' as const,
    physicalName,
    deferrable: boolean(row.condeferrable),
    initially: boolean(row.condeferred)
      ? ('deferred' as const)
      : ('immediate' as const),
    validated: boolean(row.convalidated),
    reference: reference(
      'constraint',
      physicalName,
      namespace,
      'pg_constraint',
      'oid',
      row.oid
    ),
    dialect:
      row.convalidated === false
        ? {
            dialect: 'postgresql' as const,
            version: 1,
            data: { notValid: true },
          }
        : undefined,
  }
  if (kind === 'p')
    return {
      kind: 'primary-key',
      ...common,
      columns,
    } satisfies CatalogPrimaryKeyConstraint
  if (kind === 'u') {
    return {
      kind: 'unique',
      ...common,
      columns,
      nulls: boolean(row.indnullsnotdistinct) ? 'not-distinct' : 'distinct',
    } satisfies CatalogUniqueConstraint
  }
  if (kind === 'c') {
    return {
      kind: 'check',
      ...common,
      expression: sql(
        text(row.definition) ?? 'CHECK (true)',
        namespace,
        table,
        physicalName
      ),
    } satisfies CatalogCheckConstraint
  }
  if (kind !== 'f') return undefined
  const targetTable = tableByOid.get(text(row.target_table_oid))
  if (!targetTable) {
    diagnostics.push(
      createIntrospectionDiagnostic({
        severity: 'error',
        code: 'unresolved-reference',
        message: `PostgreSQL foreign key target ${text(row.target_table_oid) ?? 'unknown'} was not found`,
        path: ['tables', table.id, 'constraints', physicalName],
      })
    )
    return undefined
  }
  const targetNumbers = integerArray(row.confkey)
  const targetColumns = targetNumbers.map(numberValue => {
    const targetColumn = (targetTable.columns as readonly CatalogColumn[])[
      numberValue - 1
    ]
    return targetColumn?.physicalName ?? `attnum_${numberValue}`
  })
  return {
    kind: 'foreign-key',
    ...common,
    columns,
    target: { table: targetTable.physicalName, columns: targetColumns },
    onUpdate: referentialAction(row.confupdtype),
    onDelete: referentialAction(row.confdeltype),
    match: matchType(row.confmatchtype),
  } satisfies CatalogForeignKeyConstraint
}

function mapIndexes(
  rows: readonly PostgresIndexRow[],
  table: CatalogTable,
  columnsByNumber: ReadonlyMap<number, string>,
  namespace: string
): readonly CatalogIndex[] {
  const grouped = new Map<string, PostgresIndexRow[]>()
  for (const row of rows) {
    const key = text(row.index_oid) ?? text(row.physical_name) ?? 'unknown'
    const existing = grouped.get(key) ?? []
    existing.push(row)
    grouped.set(key, existing)
  }
  return [...grouped.values()].map(indexRows => {
    const first = indexRows[0]
    const physicalName =
      text(first.physical_name) ?? `index_${text(first.index_oid) ?? 'unknown'}`
    const keyCount = number(first.indnkeyatts) ?? indexRows.length
    const terms: CatalogIndexTerm[] = []
    const includedColumns: string[] = []
    for (const row of indexRows) {
      const position = number(row.position) ?? 0
      const attnum = number(row.attnum) ?? 0
      const columnName = attnum > 0 ? columnsByNumber.get(attnum) : undefined
      if (position > keyCount) {
        if (columnName) includedColumns.push(columnName)
        continue
      }
      terms.push(
        columnName
          ? {
              kind: 'column',
              column: columnName,
              position,
              ...indexTermOptions(row, text(first.method)),
            }
          : {
              kind: 'expression',
              expression: sql(
                text(row.term_definition) ?? '/* expression unavailable */',
                namespace,
                table,
                physicalName
              ),
              position,
              ...indexTermOptions(row, text(first.method)),
            }
      )
    }
    return {
      kind: 'index',
      id: stableId(physicalName),
      identitySource: 'physical-name',
      physicalName,
      unique: boolean(first.indisunique),
      terms,
      predicate: text(first.predicate)
        ? sql(text(first.predicate) as string, namespace, table, physicalName)
        : undefined,
      includedColumns: includedColumns.length > 0 ? includedColumns : undefined,
      method: text(first.method),
      dialect:
        text(first.method) && text(first.method) !== 'btree'
          ? {
              dialect: 'postgresql' as const,
              version: 1,
              data: { method: text(first.method) as string },
            }
          : undefined,
      reference: reference(
        'index',
        physicalName,
        namespace,
        'pg_class',
        'oid',
        first.index_oid
      ),
    } satisfies CatalogIndex
  })
}

function indexTermOptions(
  row: PostgresIndexRow,
  method: string | undefined
): Pick<CatalogIndexTerm, 'direction' | 'nulls'> {
  const option = number(row.indoption)
  if (method !== 'btree' || option === undefined) return {}
  return {
    direction: option & 1 ? 'DESC' : 'ASC',
    nulls: option & 2 ? 'FIRST' : 'LAST',
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
    dialect: 'postgresql' as const,
    text: textValue,
    provenance: {
      kind: 'decompiler' as const,
      dialect: 'postgresql' as const,
      reference: reference(
        'table',
        name,
        namespace,
        'pg_class',
        'relname',
        table.physicalName
      ),
    },
  }
}

function reference(
  kind: CatalogReference['kind'],
  name: string,
  namespace: string | undefined,
  relation: string,
  key: string,
  value: unknown = name
): CatalogReference {
  return {
    kind,
    name,
    namespace,
    catalog: {
      relation,
      key,
      value: typeof value === 'number' ? value : String(value),
    },
  }
}

function stableId(value: string): string {
  if (value.length > 0 && !/[.\\\u0000-\u001f\u007f]/.test(value)) return value
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `introspected_${(hash >>> 0).toString(16)}`
}

function groupBy<Row>(
  rows: readonly Row[],
  key: (row: Row) => unknown
): Map<unknown, Row[]> {
  const result = new Map<unknown, Row[]>()
  for (const row of rows) {
    const value = key(row)
    const group = result.get(value) ?? []
    group.push(row)
    result.set(value, group)
  }
  return result
}

function text(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : String(value)
}

function number(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function boolean(value: unknown): boolean {
  return value === true || value === 't' || value === 'true' || value === 1
}

function integerArray(value: unknown): number[] {
  if (Array.isArray(value)) return value.map(item => number(item) ?? 0)
  const parsed = text(value)?.replace(/[{}]/g, '').trim()
  if (!parsed) return []
  return parsed.split(',').map(item => number(item.trim()) ?? 0)
}

function referentialAction(
  value: unknown
): CatalogForeignKeyConstraint['onUpdate'] {
  return (
    {
      a: 'no-action',
      r: 'restrict',
      c: 'cascade',
      n: 'set-null',
      d: 'set-default',
    } as const
  )[text(value) as 'a']
}

function matchType(value: unknown): CatalogForeignKeyConstraint['match'] {
  return ({ s: 'simple', f: 'full', p: 'partial' } as const)[text(value) as 's']
}
