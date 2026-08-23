import type { CatalogConnection } from './connection.ts'
import { createIntrospectionDiagnostic } from './diagnostics.ts'
import type {
  CatalogCheckConstraint,
  CatalogColumn,
  CatalogConstraint,
  CatalogData,
  CatalogDeferredObject,
  CatalogDialectExtension,
  CatalogComment,
  CatalogForeignKeyConstraint,
  CatalogIdentity,
  CatalogIndex,
  CatalogIndexTerm,
  CatalogObjectReference,
  CatalogOpaqueObject,
  CatalogPartition,
  CatalogScalar,
  CatalogPrimaryKeyConstraint,
  CatalogQueryRow,
  CatalogReference,
  CatalogRoutine,
  CatalogRoutineParameter,
  CatalogServerInfo,
  CatalogStorageType,
  CatalogTable,
  CatalogTrigger,
  CatalogUniqueConstraint,
  CatalogView,
  IntrospectionCatalog,
  IntrospectionOptions,
} from './types.ts'

export const mysqlServerQuery = `SELECT VERSION() AS version, @@version_comment AS version_comment`
export const mysqlTablesQuery = `
  SELECT TABLE_NAME AS table_name, TABLE_TYPE AS table_type,
         ENGINE AS engine, TABLE_COLLATION AS table_collation,
         CREATE_OPTIONS AS create_options, TABLE_COMMENT AS table_comment
  FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = ?
  ORDER BY TABLE_NAME
`
export const mysqlColumnsQuery = `
  SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name,
         ORDINAL_POSITION AS ordinal_position, COLUMN_TYPE AS column_type,
         DATA_TYPE AS data_type,
         IS_NULLABLE AS is_nullable, COLUMN_DEFAULT AS column_default,
         EXTRA AS extra, GENERATION_EXPRESSION AS generation_expression,
         CHARACTER_SET_NAME AS character_set_name,
         COLLATION_NAME AS collation_name, COLUMN_COMMENT AS column_comment
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
         SUB_PART AS sub_part, IS_VISIBLE AS is_visible,
         COMMENT AS comment, INDEX_COMMENT AS index_comment
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = ?
  ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX
`

/** View definitions and execution properties for the selected database. */
export const mysqlViewsQuery = `
  SELECT TABLE_NAME AS table_name, VIEW_DEFINITION AS view_definition,
         CHECK_OPTION AS check_option, IS_UPDATABLE AS is_updatable,
         SECURITY_TYPE AS security_type, DEFINER AS definer
  FROM INFORMATION_SCHEMA.VIEWS
  WHERE TABLE_SCHEMA = ?
  ORDER BY TABLE_NAME
`

/** Stored function and procedure declarations for the selected database. */
export const mysqlRoutinesQuery = `
  SELECT ROUTINE_NAME AS routine_name, ROUTINE_TYPE AS routine_type,
         DATA_TYPE AS data_type, DTD_IDENTIFIER AS dtd_identifier,
         ROUTINE_BODY AS routine_body,
         ROUTINE_DEFINITION AS routine_definition,
         EXTERNAL_LANGUAGE AS external_language,
         SQL_DATA_ACCESS AS sql_data_access,
         IS_DETERMINISTIC AS is_deterministic,
         SECURITY_TYPE AS security_type, SQL_MODE AS sql_mode,
         ROUTINE_COMMENT AS routine_comment
  FROM INFORMATION_SCHEMA.ROUTINES
  WHERE ROUTINE_SCHEMA = ?
  ORDER BY ROUTINE_NAME, ROUTINE_TYPE
`

/** Parameter rows, including the ordinal zero return row for functions. */
export const mysqlRoutineParametersQuery = `
  SELECT SPECIFIC_NAME AS routine_name, ORDINAL_POSITION AS ordinal_position,
         PARAMETER_MODE AS parameter_mode, PARAMETER_NAME AS parameter_name,
         DATA_TYPE AS data_type, DTD_IDENTIFIER AS dtd_identifier
  FROM INFORMATION_SCHEMA.PARAMETERS
  WHERE SPECIFIC_SCHEMA = ?
  ORDER BY SPECIFIC_NAME, ORDINAL_POSITION
`

/** Trigger bodies and their table/event metadata. */
export const mysqlTriggersQuery = `
  SELECT TRIGGER_NAME AS trigger_name, EVENT_MANIPULATION AS event_manipulation,
         EVENT_OBJECT_TABLE AS table_name, ACTION_CONDITION AS action_condition,
         ACTION_STATEMENT AS action_statement,
         ACTION_ORIENTATION AS action_orientation,
         ACTION_TIMING AS action_timing, ACTION_ORDER AS action_order,
         DEFINER AS definer, SQL_MODE AS sql_mode
  FROM INFORMATION_SCHEMA.TRIGGERS
  WHERE TRIGGER_SCHEMA = ?
  ORDER BY TRIGGER_NAME, ACTION_ORDER
`

/** Partition and subpartition declarations for tables in the selected database. */
export const mysqlPartitionsQuery = `
  SELECT TABLE_NAME AS table_name, PARTITION_NAME AS partition_name,
         SUBPARTITION_NAME AS subpartition_name,
         PARTITION_ORDINAL_POSITION AS partition_ordinal_position,
         SUBPARTITION_ORDINAL_POSITION AS subpartition_ordinal_position,
         PARTITION_METHOD AS partition_method,
         SUBPARTITION_METHOD AS subpartition_method,
         PARTITION_EXPRESSION AS partition_expression,
         SUBPARTITION_EXPRESSION AS subpartition_expression,
         PARTITION_DESCRIPTION AS partition_description,
         PARTITION_COMMENT AS partition_comment,
         TABLESPACE_NAME AS tablespace_name
  FROM INFORMATION_SCHEMA.PARTITIONS
  WHERE TABLE_SCHEMA = ? AND PARTITION_NAME IS NOT NULL
  ORDER BY TABLE_NAME, PARTITION_ORDINAL_POSITION, SUBPARTITION_ORDINAL_POSITION
`

/** Collations used by tables or columns in the selected database. */
export const mysqlCollationsQuery = `
  SELECT c.COLLATION_NAME AS collation_name,
         c.CHARACTER_SET_NAME AS character_set_name,
         c.ID AS collation_id, c.IS_DEFAULT AS is_default,
         c.IS_COMPILED AS is_compiled, c.SORTLEN AS sort_length,
         c.PAD_ATTRIBUTE AS pad_attribute
  FROM INFORMATION_SCHEMA.COLLATIONS c
  JOIN (
    SELECT DISTINCT TABLE_COLLATION AS collation_name
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = ? AND TABLE_COLLATION IS NOT NULL
    UNION
    SELECT DISTINCT COLLATION_NAME AS collation_name
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = ? AND COLLATION_NAME IS NOT NULL
  ) used ON used.collation_name = c.COLLATION_NAME
  ORDER BY c.COLLATION_NAME
`

/** Scheduled events are retained as opaque MySQL objects, not migration input. */
export const mysqlEventsQuery = `
  SELECT EVENT_NAME AS event_name, EVENT_TYPE AS event_type,
         STATUS AS status, EVENT_DEFINITION AS event_definition,
         EVENT_BODY AS event_body, EXECUTE_AT AS execute_at,
         INTERVAL_VALUE AS interval_value, INTERVAL_FIELD AS interval_field,
         EVENT_COMMENT AS event_comment, DEFINER AS definer
  FROM INFORMATION_SCHEMA.EVENTS
  WHERE EVENT_SCHEMA = ?
  ORDER BY EVENT_NAME
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
  const deferredObjects: CatalogDeferredObject[] = []
  const opaqueObjects: CatalogOpaqueObject[] = []
  const views: CatalogView[] = []
  const comments: CatalogComment[] = []
  const tableByName = new Map(tables.map(item => [item.physicalName, item]))
  const viewRows = await query<MySqlViewRow>(
    connection,
    mysqlViewsQuery,
    [options.namespace],
    options,
    diagnostics,
    'views'
  )
  const viewRowsByName = new Map(
    viewRows.map(row => [text(row.table_name) ?? '', row])
  )
  for (const row of tableRows.filter(
    currentRow => text(currentRow.table_type) !== 'BASE TABLE'
  )) {
    const kind = text(row.table_type)?.toUpperCase()
    if (kind === 'VIEW' || kind === 'SYSTEM VIEW') {
      const mapped = viewObject(
        row,
        viewRowsByName.get(text(row.table_name) ?? ''),
        options.namespace,
        diagnostics
      )
      if (mapped.kind === 'deferred-object') deferredObjects.push(mapped)
      else views.push(mapped)
    } else {
      const mapped = deferred(row, options.namespace)
      deferredObjects.push(mapped)
      diagnostics.push(
        createIntrospectionDiagnostic({
          severity: 'warning',
          code: 'unmodeled-object',
          message: `MySQL object ${mapped.physicalName} (${kind ?? 'unknown'}) is retained as a deferred record`,
          path: ['deferredObjects', mapped.physicalName],
          physicalReference: mapped.reference,
          remediation:
            'Inspect the deferred record before using it as migration input.',
        })
      )
    }
  }
  const relationByName = new Map<string, CatalogObjectReference>()
  for (const currentTable of tables)
    relationByName.set(currentTable.physicalName, {
      kind: 'table',
      id: currentTable.id,
    })
  for (const view of views)
    relationByName.set(view.physicalName, { kind: 'view', id: view.id })
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
  for (const view of views) {
    const rows = columnRows.filter(
      row => text(row.table_name) === view.physicalName
    )
    ;(view as Mutable<CatalogView>).columns = rows.map(row =>
      column(row, view, options.namespace)
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
  const routineRows = await query<MySqlRoutineRow>(
    connection,
    mysqlRoutinesQuery,
    [options.namespace],
    options,
    diagnostics,
    'routines'
  )
  const routineParameterRows = await query<MySqlRoutineParameterRow>(
    connection,
    mysqlRoutineParametersQuery,
    [options.namespace],
    options,
    diagnostics,
    'routine-parameters'
  )
  const routineParameters = new Map<string, MySqlRoutineParameterRow[]>()
  for (const row of routineParameterRows) {
    const name = text(row.routine_name) ?? 'unknown'
    const group = routineParameters.get(name) ?? []
    group.push(row)
    routineParameters.set(name, group)
  }
  const routines = routineRows.map(row => {
    const routine = routineObject(
      row,
      routineParameters.get(text(row.routine_name) ?? '') ?? [],
      options.namespace
    )
    if (routine.comment) comments.push(routine.comment)
    relationByName.set(routine.physicalName, {
      kind: 'routine',
      id: routine.id,
    })
    return routine
  })

  const triggerRows = await query<MySqlTriggerRow>(
    connection,
    mysqlTriggersQuery,
    [options.namespace],
    options,
    diagnostics,
    'triggers'
  )
  const triggers: CatalogTrigger[] = []
  for (const rows of groupRows(
    triggerRows,
    row => text(row.trigger_name) ?? 'unknown'
  )) {
    const mapped = triggerObject(
      rows,
      relationByName,
      options.namespace,
      diagnostics
    )
    if (mapped.kind === 'trigger') triggers.push(mapped)
    else deferredObjects.push(mapped)
  }

  const partitionRows = await query<MySqlPartitionRow>(
    connection,
    mysqlPartitionsQuery,
    [options.namespace],
    options,
    diagnostics,
    'partitions'
  )
  const partitions: CatalogPartition[] = []
  for (const row of partitionRows) {
    const mapped = partitionObject(
      row,
      tableByName,
      options.namespace,
      diagnostics
    )
    if (mapped.kind === 'partition') {
      partitions.push(mapped)
      if (mapped.comment) comments.push(mapped.comment)
    } else deferredObjects.push(mapped)
  }

  const collationRows = await query<MySqlCollationRow>(
    connection,
    mysqlCollationsQuery,
    [options.namespace, options.namespace],
    options,
    diagnostics,
    'collations'
  )
  const usedCollations = new Set(
    [
      ...tableRows.map(row => text(row.table_collation)),
      ...columnRows.map(row => text(row.collation_name)),
    ].filter((value): value is string => value !== undefined)
  )
  const collations = collationRows
    .filter(row => {
      const name = text(row.collation_name)
      return name !== undefined && usedCollations.has(name)
    })
    .map(row => collationObject(row, options.namespace))

  const eventRows = await query<MySqlEventRow>(
    connection,
    mysqlEventsQuery,
    [options.namespace],
    options,
    diagnostics,
    'events'
  )
  for (const row of eventRows) {
    const event = opaqueEvent(row, options.namespace)
    opaqueObjects.push(event)
    diagnostics.push(
      createIntrospectionDiagnostic({
        severity: 'warning',
        code: 'unmodeled-object',
        message: `MySQL event ${event.physicalName} is retained as opaque data`,
        path: ['opaqueObjects', event.physicalName],
        physicalReference: event.reference,
        remediation:
          'Inspect the event definition before treating it as migration input.',
      })
    )
    const eventComment = text(row.event_comment)
    if (eventComment !== undefined && eventComment !== '')
      comments.push(
        objectComment(
          { kind: 'opaque-object', id: event.id },
          eventComment,
          event.reference,
          options.namespace
        )
      )
  }

  for (const currentTable of tables) {
    const source = tableRows.find(
      row => text(row.table_name) === currentTable.physicalName
    )
    const tableComment = text(source?.table_comment)
    if (tableComment !== undefined && tableComment !== '')
      comments.push(
        objectComment(
          { kind: 'table', id: currentTable.id },
          tableComment,
          currentTable.reference,
          options.namespace
        )
      )
    for (const currentColumn of currentTable.columns) {
      const columnSource = columnRows.find(
        row =>
          text(row.table_name) === currentTable.physicalName &&
          text(row.column_name) === currentColumn.physicalName
      )
      const columnComment = text(columnSource?.column_comment)
      if (columnComment !== undefined && columnComment !== '')
        comments.push(
          objectComment(
            { kind: 'column', id: currentColumn.id },
            columnComment,
            currentColumn.reference,
            options.namespace
          )
        )
    }
  }
  for (const view of views) {
    const source = tableRows.find(
      row => text(row.table_name) === view.physicalName
    )
    const viewComment = text(source?.table_comment)
    if (viewComment !== undefined && viewComment !== '')
      comments.push(
        objectComment(
          { kind: view.kind, id: view.id },
          viewComment,
          view.reference,
          options.namespace
        )
      )
    for (const currentColumn of view.columns) {
      const columnSource = columnRows.find(
        row =>
          text(row.table_name) === view.physicalName &&
          text(row.column_name) === currentColumn.physicalName
      )
      const columnComment = text(columnSource?.column_comment)
      if (columnComment !== undefined && columnComment !== '')
        comments.push(
          objectComment(
            { kind: 'column', id: currentColumn.id },
            columnComment,
            currentColumn.reference,
            options.namespace
          )
        )
    }
  }
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
    visibility: server.capabilities.visibility,
  }
  const serverCapabilities = {
    ...server.capabilities,
    views: true,
    materializedViews: false,
    sequences: false,
    enums: false,
    domains: false,
    collations: true,
    routines: true,
    triggers: true,
    partitions: true,
    policies: false,
    extensions: false,
    comments: true,
    ownership: false,
    scheduledEvents: true,
    tableEngines: true,
    generatedColumnModes: true,
    selectedNamespace: options.namespace,
    productFamily: server.product === 'mariadb' ? 'mariadb' : 'mysql8',
  }
  const namespace = {
    kind: 'mysql-database' as const,
    name: options.namespace,
    reference: reference(
      'namespace',
      options.namespace,
      options.namespace,
      'INFORMATION_SCHEMA.SCHEMATA',
      'SCHEMA_NAME'
    ),
    dialect: mysqlExtension({
      selectedNamespace: options.namespace,
      views: true,
      materializedViews: false,
      sequences: false,
      routines: true,
      triggers: true,
      partitions: true,
      collations: true,
      comments: true,
      ownership: false,
      policies: false,
      extensions: false,
    }),
  }
  return Object.freeze({
    dialect: 'mysql' as const,
    server: { ...server, capabilities: serverCapabilities },
    namespace,
    tables: Object.freeze(tables),
    views: Object.freeze(views),
    collations: Object.freeze(collations),
    routines: Object.freeze(routines),
    triggers: Object.freeze(triggers),
    partitions: Object.freeze(partitions),
    deferredObjects: Object.freeze(deferredObjects),
    opaqueObjects: Object.freeze(opaqueObjects),
    comments: Object.freeze(comments),
    ownership: Object.freeze([]),
    capabilities,
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
  readonly engine?: unknown
  readonly table_collation?: unknown
  readonly create_options?: unknown
  readonly table_comment?: unknown
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
  readonly character_set_name?: unknown
  readonly collation_name?: unknown
  readonly column_comment?: unknown
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
  readonly is_visible?: unknown
  readonly comment?: unknown
  readonly index_comment?: unknown
}

interface MySqlViewRow extends CatalogQueryRow {
  readonly table_name?: unknown
  readonly view_definition?: unknown
  readonly check_option?: unknown
  readonly is_updatable?: unknown
  readonly security_type?: unknown
  readonly definer?: unknown
}

interface MySqlRoutineRow extends CatalogQueryRow {
  readonly routine_name?: unknown
  readonly routine_type?: unknown
  readonly data_type?: unknown
  readonly dtd_identifier?: unknown
  readonly routine_body?: unknown
  readonly routine_definition?: unknown
  readonly external_language?: unknown
  readonly sql_data_access?: unknown
  readonly is_deterministic?: unknown
  readonly security_type?: unknown
  readonly sql_mode?: unknown
  readonly routine_comment?: unknown
}

interface MySqlRoutineParameterRow extends CatalogQueryRow {
  readonly routine_name?: unknown
  readonly ordinal_position?: unknown
  readonly parameter_mode?: unknown
  readonly parameter_name?: unknown
  readonly data_type?: unknown
  readonly dtd_identifier?: unknown
}

interface MySqlTriggerRow extends CatalogQueryRow {
  readonly trigger_name?: unknown
  readonly event_manipulation?: unknown
  readonly table_name?: unknown
  readonly action_condition?: unknown
  readonly action_statement?: unknown
  readonly action_orientation?: unknown
  readonly action_timing?: unknown
  readonly action_order?: unknown
  readonly definer?: unknown
  readonly sql_mode?: unknown
}

interface MySqlPartitionRow extends CatalogQueryRow {
  readonly table_name?: unknown
  readonly partition_name?: unknown
  readonly subpartition_name?: unknown
  readonly partition_ordinal_position?: unknown
  readonly subpartition_ordinal_position?: unknown
  readonly partition_method?: unknown
  readonly subpartition_method?: unknown
  readonly partition_expression?: unknown
  readonly subpartition_expression?: unknown
  readonly partition_description?: unknown
  readonly partition_comment?: unknown
  readonly tablespace_name?: unknown
}

interface MySqlCollationRow extends CatalogQueryRow {
  readonly collation_name?: unknown
  readonly character_set_name?: unknown
  readonly collation_id?: unknown
  readonly is_default?: unknown
  readonly is_compiled?: unknown
  readonly sort_length?: unknown
  readonly pad_attribute?: unknown
}

interface MySqlEventRow extends CatalogQueryRow {
  readonly event_name?: unknown
  readonly event_type?: unknown
  readonly status?: unknown
  readonly event_definition?: unknown
  readonly event_body?: unknown
  readonly execute_at?: unknown
  readonly interval_value?: unknown
  readonly interval_field?: unknown
  readonly event_comment?: unknown
  readonly definer?: unknown
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
    major === 8 &&
    ((minor ?? 0) > 0 || ((minor ?? 0) === 0 && Number(parts?.[3] ?? 0) >= 16))
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
      indexExpressions: supported,
      indexPredicates: false,
      indexIncludedColumns: false,
      namespaces: true,
      visibility: 'complete',
      mysql8: supported,
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
    dialect: mysqlExtension({
      ...(text(row.engine) === undefined ? {} : { engine: text(row.engine)! }),
      ...(text(row.table_collation) === undefined
        ? {}
        : { collation: text(row.table_collation)! }),
      ...(text(row.create_options) === undefined
        ? {}
        : { createOptions: text(row.create_options)! }),
    }),
  }
}

function deferred(
  row: MySqlTableRow,
  namespace: string
): CatalogDeferredObject {
  const physicalName = text(row.table_name) ?? 'unnamed_object'
  return {
    kind: 'deferred-object',
    id: stableId(`deferred:${text(row.table_type) ?? 'other'}:${physicalName}`),
    identitySource: 'physical-name',
    objectKind:
      text(row.table_type)?.toUpperCase() === 'VIEW' ||
      text(row.table_type)?.toUpperCase() === 'SYSTEM VIEW'
        ? 'view'
        : 'other',
    physicalName,
    reference: reference(
      'deferred-object',
      physicalName,
      namespace,
      'INFORMATION_SCHEMA.TABLES',
      'TABLE_NAME'
    ),
    dialect: mysqlExtension({
      ...(text(row.table_type) === undefined
        ? {}
        : { tableType: text(row.table_type)! }),
      ...(text(row.engine) === undefined ? {} : { engine: text(row.engine)! }),
    }),
  }
}

function column(
  row: MySqlColumnRow,
  table: CatalogTable | CatalogView,
  namespace: string
): CatalogColumn {
  const physicalName = text(row.column_name) ?? 'unnamed_column'
  const extra = text(row.extra) ?? ''
  const generationExpression = text(row.generation_expression)
  const generated =
    generationExpression !== undefined &&
    (/GENERATED/i.test(extra) || generationExpression !== '')
      ? {
          kind: 'generated' as const,
          mode: /VIRTUAL/i.test(extra)
            ? ('virtual' as const)
            : /STORED/i.test(extra)
              ? ('stored' as const)
              : ('unknown' as const),
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
    dialect: mysqlExtension({
      ...(text(row.data_type) === undefined
        ? {}
        : { dataType: text(row.data_type)! }),
      ...(text(row.character_set_name) === undefined
        ? {}
        : { characterSet: text(row.character_set_name)! }),
      ...(text(row.collation_name) === undefined
        ? {}
        : { collation: text(row.collation_name)! }),
      ...(extra === '' ? {} : { extra }),
    }),
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
    dialect: mysqlExtension({
      ...(text(first.index_type) === undefined
        ? {}
        : { indexType: text(first.index_type)! }),
      ...(text(first.is_visible) === undefined
        ? {}
        : { visible: text(first.is_visible)!.toUpperCase() !== 'NO' }),
      ...(text(first.comment) === undefined
        ? {}
        : { comment: text(first.comment)! }),
      ...(text(first.index_comment) === undefined
        ? {}
        : { indexComment: text(first.index_comment)! }),
    }),
    reference: reference(
      'index',
      physicalName,
      namespace,
      'INFORMATION_SCHEMA.STATISTICS',
      'INDEX_NAME'
    ),
  }
}

function viewObject(
  tableRow: MySqlTableRow,
  viewRow: MySqlViewRow | undefined,
  namespace: string,
  diagnostics: IntrospectionCatalog['diagnostics'][number][]
): CatalogView | CatalogDeferredObject {
  const physicalName = text(tableRow.table_name) ?? 'unnamed_view'
  const physicalReference = reference(
    'view',
    physicalName,
    namespace,
    'INFORMATION_SCHEMA.VIEWS',
    'TABLE_NAME'
  )
  const definition = text(viewRow?.view_definition)
  if (definition === undefined || definition.trim() === '') {
    diagnostics.push(
      createIntrospectionDiagnostic({
        severity: 'error',
        code: 'expression-parse-failed',
        message: `MySQL view ${physicalName} has no recoverable definition`,
        path: ['views', physicalName, 'definition'],
        physicalReference,
        remediation:
          'Grant the metadata privilege needed to read INFORMATION_SCHEMA.VIEWS.VIEW_DEFINITION.',
      })
    )
    return {
      kind: 'deferred-object',
      id: stableId(`view:${physicalName}`),
      identitySource: 'physical-name',
      objectKind: 'view',
      physicalName,
      reference: physicalReference,
      dialect: mysqlExtension({
        reason: 'definition-unavailable',
        ...(text(viewRow?.definer) === undefined
          ? {}
          : { definer: text(viewRow?.definer)! }),
      }),
    }
  }
  const checkOption = normalizeCheckOption(viewRow?.check_option)
  const securityType = text(viewRow?.security_type)?.toUpperCase()
  const view: CatalogView = {
    kind: 'view',
    id: stableId(physicalName),
    identitySource: 'physical-name',
    physicalName,
    columns: [],
    definition: sql(
      definition,
      namespace,
      { kind: 'view', physicalName, reference: physicalReference },
      physicalName
    ),
    ...(checkOption === undefined ? {} : { checkOption }),
    ...(securityType === 'INVOKER' ? { securityInvoker: true } : {}),
    reference: physicalReference,
    provenance: {
      kind: 'catalog',
      dialect: 'mysql',
      reference: physicalReference,
    },
    dialect: mysqlExtension({
      ...(text(viewRow?.is_updatable) === undefined
        ? {}
        : { isUpdatable: text(viewRow?.is_updatable)! }),
      ...(securityType === undefined ? {} : { securityType }),
      ...(text(viewRow?.definer) === undefined
        ? {}
        : { definer: text(viewRow?.definer)! }),
    }),
  }
  return view
}

function routineObject(
  row: MySqlRoutineRow,
  parameterRows: readonly MySqlRoutineParameterRow[],
  namespace: string
): CatalogRoutine {
  const physicalName = text(row.routine_name) ?? 'unnamed_routine'
  const physicalReference = reference(
    'routine',
    physicalName,
    namespace,
    'INFORMATION_SCHEMA.ROUTINES',
    'ROUTINE_NAME'
  )
  const parameters = parameterRows
    .filter(row => (number(row.ordinal_position) ?? 0) > 0)
    .sort(
      (left, right) =>
        (number(left.ordinal_position) ?? 0) -
        (number(right.ordinal_position) ?? 0)
    )
    .map(routineParameter)
  const definition = text(row.routine_definition)
  const returnType = text(row.data_type)
  const routine: CatalogRoutine = {
    kind: 'routine',
    id: stableId(physicalName),
    identitySource: 'physical-name',
    physicalName,
    routineKind:
      text(row.routine_type)?.toUpperCase() === 'FUNCTION'
        ? 'function'
        : text(row.routine_type)?.toUpperCase() === 'PROCEDURE'
          ? 'procedure'
          : 'unknown',
    parameters,
    ...(returnType === undefined || returnType.toUpperCase() === 'VOID'
      ? {}
      : { returnType: storage(row.data_type, row.dtd_identifier) }),
    ...(text(row.external_language) === undefined &&
    text(row.routine_body) === undefined
      ? {}
      : {
          language:
            text(row.external_language) ?? text(row.routine_body) ?? 'unknown',
        }),
    ...(definition === undefined
      ? {}
      : {
          body: sql(
            definition,
            namespace,
            { kind: 'routine', physicalName, reference: physicalReference },
            physicalName
          ),
        }),
    volatility: 'unknown',
    ...(text(row.security_type) === undefined
      ? {}
      : { security: routineSecurity(row.security_type) }),
    reference: physicalReference,
    provenance: {
      kind: 'catalog',
      dialect: 'mysql',
      reference: physicalReference,
    },
    dialect: mysqlExtension({
      ...(text(row.is_deterministic) === undefined
        ? {}
        : {
            deterministic: text(row.is_deterministic)!.toUpperCase() === 'YES',
          }),
      ...(text(row.sql_data_access) === undefined
        ? {}
        : { sqlDataAccess: text(row.sql_data_access)! }),
      ...(text(row.sql_mode) === undefined
        ? {}
        : { sqlMode: text(row.sql_mode)! }),
    }),
  }
  const commentText = text(row.routine_comment)
  if (commentText === undefined || commentText === '') return routine
  return {
    ...routine,
    comment: objectComment(
      { kind: 'routine', id: routine.id },
      commentText,
      physicalReference,
      namespace
    ),
  }
}

function routineParameter(
  row: MySqlRoutineParameterRow
): CatalogRoutineParameter {
  const parameterName = text(row.parameter_name)
  return {
    ...(parameterName === undefined ? {} : { name: parameterName }),
    ...(routineParameterMode(row.parameter_mode) === undefined
      ? {}
      : { mode: routineParameterMode(row.parameter_mode) }),
    storage: storage(row.data_type, row.dtd_identifier),
    ordinalPosition: number(row.ordinal_position) ?? 0,
  }
}

function triggerObject(
  rows: readonly MySqlTriggerRow[],
  relations: ReadonlyMap<string, CatalogObjectReference>,
  namespace: string,
  diagnostics: IntrospectionCatalog['diagnostics'][number][]
): CatalogTrigger | CatalogDeferredObject {
  const first = rows[0]
  const physicalName = text(first.trigger_name) ?? 'unnamed_trigger'
  const physicalReference = reference(
    'trigger',
    physicalName,
    namespace,
    'INFORMATION_SCHEMA.TRIGGERS',
    'TRIGGER_NAME'
  )
  const tableName = text(first.table_name)
  const target = tableName === undefined ? undefined : relations.get(tableName)
  const body = text(first.action_statement)
  if (target === undefined || body === undefined || body.trim() === '') {
    if (target === undefined)
      diagnostics.push(
        createIntrospectionDiagnostic({
          severity: 'error',
          code: 'unresolved-reference',
          message: `MySQL trigger ${physicalName} target ${tableName ?? 'unknown'} was not found`,
          path: ['triggers', physicalName, 'table'],
          physicalReference,
        })
      )
    if (body === undefined || body.trim() === '')
      diagnostics.push(
        createIntrospectionDiagnostic({
          severity: 'error',
          code: 'expression-parse-failed',
          message: `MySQL trigger ${physicalName} has no recoverable body`,
          path: ['triggers', physicalName, 'body'],
          physicalReference,
        })
      )
    return {
      kind: 'deferred-object',
      id: stableId(`trigger:${physicalName}`),
      identitySource: 'physical-name',
      objectKind: 'trigger',
      physicalName,
      reference: physicalReference,
      dialect: mysqlExtension({
        ...(tableName === undefined ? {} : { tableName }),
        ...(body === undefined ? {} : { actionStatement: body }),
      }),
    }
  }
  const timing = triggerTiming(first.action_timing)
  const events = [
    ...new Set(
      rows
        .map(row => triggerEvent(row.event_manipulation))
        .filter(
          (value): value is CatalogTrigger['events'][number] =>
            value !== undefined
        )
    ),
  ] as CatalogTrigger['events']
  return {
    kind: 'trigger',
    id: stableId(physicalName),
    identitySource: 'physical-name',
    physicalName,
    table: target,
    timing,
    events,
    orientation: triggerOrientation(first.action_orientation),
    ...(text(first.action_condition) === undefined
      ? {}
      : {
          condition: sql(
            text(first.action_condition)!,
            namespace,
            { kind: 'trigger', physicalName, reference: physicalReference },
            physicalName
          ),
        }),
    body: sql(
      body,
      namespace,
      { kind: 'trigger', physicalName, reference: physicalReference },
      physicalName
    ),
    reference: physicalReference,
    provenance: {
      kind: 'catalog',
      dialect: 'mysql',
      reference: physicalReference,
    },
    dialect: mysqlExtension({
      ...(text(first.definer) === undefined
        ? {}
        : { definer: text(first.definer)! }),
      ...(text(first.sql_mode) === undefined
        ? {}
        : { sqlMode: text(first.sql_mode)! }),
      ...(number(first.action_order) === undefined
        ? {}
        : { actionOrder: number(first.action_order)! }),
    }),
  }
}

function partitionObject(
  row: MySqlPartitionRow,
  tables: ReadonlyMap<string, CatalogTable>,
  namespace: string,
  diagnostics: IntrospectionCatalog['diagnostics'][number][]
): CatalogPartition | CatalogDeferredObject {
  const tableName = text(row.table_name) ?? 'unknown'
  const partitionName = text(row.partition_name)
  const subpartitionName = text(row.subpartition_name)
  const physicalName =
    partitionName === undefined
      ? tableName
      : subpartitionName === undefined
        ? partitionName
        : `${partitionName}/${subpartitionName}`
  const physicalReference = reference(
    'partition',
    physicalName,
    namespace,
    'INFORMATION_SCHEMA.PARTITIONS',
    'PARTITION_NAME'
  )
  const parent = tables.get(tableName)
  if (parent === undefined) {
    diagnostics.push(
      createIntrospectionDiagnostic({
        severity: 'error',
        code: 'unresolved-reference',
        message: `MySQL partition ${physicalName} parent table ${tableName} was not found`,
        path: ['partitions', physicalName, 'parent'],
        physicalReference,
      })
    )
    return {
      kind: 'deferred-object',
      id: stableId(`partition:${tableName}:${physicalName}`),
      identitySource: 'physical-name',
      objectKind: 'partition',
      physicalName,
      reference: physicalReference,
      dialect: mysqlExtension({ tableName }),
    }
  }
  const method =
    text(row.subpartition_method) ?? text(row.partition_method) ?? 'UNKNOWN'
  const strategy = partitionStrategy(method)
  if (strategy === 'unknown')
    diagnostics.push(
      createIntrospectionDiagnostic({
        severity: 'warning',
        code: 'unsupported-feature',
        message: `MySQL partition method ${method} is retained with an unknown normalized strategy`,
        path: ['partitions', physicalName, 'strategy'],
        physicalReference,
      })
    )
  const boundText =
    text(row.partition_description) ??
    text(row.subpartition_expression) ??
    text(row.partition_expression)
  const expression = text(row.partition_expression)
  const partition: CatalogPartition = {
    kind: 'partition',
    id: stableId(`partition:${tableName}:${physicalName}`),
    identitySource: 'physical-name',
    physicalName,
    parent: { kind: 'table', id: parent.id },
    strategy,
    ...(expression === undefined
      ? {}
      : { keyColumns: partitionKeyColumns(expression) }),
    ...(boundText === undefined
      ? {}
      : {
          bound: sql(boundText, namespace, parent, physicalName),
        }),
    reference: physicalReference,
    dialect: mysqlExtension({
      ...(text(row.partition_method) === undefined
        ? {}
        : { partitionMethod: text(row.partition_method)! }),
      ...(text(row.subpartition_method) === undefined
        ? {}
        : { subpartitionMethod: text(row.subpartition_method)! }),
      ...(text(row.subpartition_name) === undefined
        ? {}
        : { subpartitionName: text(row.subpartition_name)! }),
      ...(text(row.tablespace_name) === undefined
        ? {}
        : { tablespace: text(row.tablespace_name)! }),
    }),
  }
  const commentText = text(row.partition_comment)
  if (commentText === undefined || commentText === '') return partition
  return {
    ...partition,
    comment: objectComment(
      { kind: 'partition', id: partition.id },
      commentText,
      physicalReference,
      namespace
    ),
  }
}

function collationObject(
  row: MySqlCollationRow,
  namespace: string
): import('./types.ts').CatalogCollation {
  const physicalName = text(row.collation_name) ?? 'unknown_collation'
  return {
    kind: 'collation',
    id: stableId(physicalName),
    identitySource: 'physical-name',
    physicalName,
    reference: reference(
      'collation',
      physicalName,
      namespace,
      'INFORMATION_SCHEMA.COLLATIONS',
      'COLLATION_NAME'
    ),
    dialect: mysqlExtension({
      ...(text(row.character_set_name) === undefined
        ? {}
        : { characterSet: text(row.character_set_name)! }),
      ...(number(row.collation_id) === undefined
        ? {}
        : { id: number(row.collation_id)! }),
      ...(text(row.is_default) === undefined
        ? {}
        : { isDefault: text(row.is_default)! === 'Yes' }),
      ...(text(row.is_compiled) === undefined
        ? {}
        : { isCompiled: text(row.is_compiled)! === 'Yes' }),
      ...(number(row.sort_length) === undefined
        ? {}
        : { sortLength: number(row.sort_length)! }),
      ...(text(row.pad_attribute) === undefined
        ? {}
        : { padAttribute: text(row.pad_attribute)! }),
    }),
  }
}

function opaqueEvent(
  row: MySqlEventRow,
  namespace: string
): CatalogOpaqueObject {
  const physicalName = text(row.event_name) ?? 'unnamed_event'
  const physicalReference = reference(
    'opaque-object',
    physicalName,
    namespace,
    'INFORMATION_SCHEMA.EVENTS',
    'EVENT_NAME'
  )
  const definition = text(row.event_definition) ?? text(row.event_body)
  return {
    kind: 'opaque-object',
    id: stableId(`event:${physicalName}`),
    identitySource: 'physical-name',
    objectKind: 'event',
    physicalName,
    data: {
      ...(text(row.event_type) === undefined
        ? {}
        : { eventType: text(row.event_type)! }),
      ...(text(row.status) === undefined ? {} : { status: text(row.status)! }),
      ...(text(row.execute_at) === undefined
        ? {}
        : { executeAt: text(row.execute_at)! }),
      ...(text(row.interval_value) === undefined
        ? {}
        : { intervalValue: text(row.interval_value)! }),
      ...(text(row.interval_field) === undefined
        ? {}
        : { intervalField: text(row.interval_field)! }),
      ...(text(row.definer) === undefined
        ? {}
        : { definer: text(row.definer)! }),
    } satisfies CatalogData & Record<string, CatalogData>,
    ...(definition === undefined
      ? {}
      : {
          sql: sql(
            definition,
            namespace,
            {
              kind: 'opaque-object',
              physicalName,
              reference: physicalReference,
            },
            physicalName
          ),
        }),
    reference: physicalReference,
    provenance: {
      kind: 'catalog',
      dialect: 'mysql',
      reference: physicalReference,
    },
    dialect: mysqlExtension({ objectKind: 'event' }),
  }
}

function objectComment(
  object: CatalogObjectReference,
  comment: string,
  physicalReference: CatalogReference | undefined,
  namespace: string
): CatalogComment {
  return {
    kind: 'comment',
    id: stableId(`${object.kind}_${object.id}_comment`),
    object,
    text: comment,
    reference: physicalReference,
    provenance: {
      kind: 'catalog',
      dialect: 'mysql',
      reference: physicalReference,
      path: ['namespace', namespace],
    },
  }
}

function groupRows<Row>(
  rows: readonly Row[],
  keyOf: (row: Row) => string
): Row[][] {
  const groups = new Map<string, Row[]>()
  for (const row of rows) {
    const key = keyOf(row)
    const group = groups.get(key) ?? []
    group.push(row)
    groups.set(key, group)
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, group]) => group)
}

function mysqlExtension(
  data: Record<string, CatalogData>
): CatalogDialectExtension {
  return { dialect: 'mysql', version: 1, data }
}

function storage(dataType: unknown, declaration: unknown): CatalogStorageType {
  return { nativeType: text(declaration) ?? text(dataType) ?? 'unknown' }
}

function normalizeCheckOption(
  value: unknown
): CatalogView['checkOption'] | undefined {
  const normalized = text(value)?.toLowerCase()
  return normalized === 'none' || normalized === undefined
    ? normalized === undefined
      ? undefined
      : 'none'
    : normalized === 'local'
      ? 'local'
      : normalized === 'cascaded'
        ? 'cascaded'
        : undefined
}

function routineSecurity(value: unknown): CatalogRoutine['security'] {
  return text(value)?.toLowerCase() === 'invoker'
    ? 'invoker'
    : text(value)?.toLowerCase() === 'definer'
      ? 'definer'
      : 'unknown'
}

function routineParameterMode(
  value: unknown
): CatalogRoutineParameter['mode'] | undefined {
  const normalized = text(value)?.toLowerCase()
  return normalized === 'in'
    ? 'in'
    : normalized === 'out'
      ? 'out'
      : normalized === 'inout'
        ? 'inout'
        : undefined
}

function triggerTiming(value: unknown): CatalogTrigger['timing'] {
  const normalized = text(value)?.toLowerCase()
  return normalized === 'before'
    ? 'before'
    : normalized === 'after'
      ? 'after'
      : 'unknown'
}

function triggerEvent(
  value: unknown
): CatalogTrigger['events'][number] | undefined {
  const normalized = text(value)?.toLowerCase()
  return normalized === 'insert' ||
    normalized === 'update' ||
    normalized === 'delete'
    ? normalized
    : undefined
}

function triggerOrientation(value: unknown): CatalogTrigger['orientation'] {
  const normalized = text(value)?.toLowerCase()
  return normalized === 'row'
    ? 'row'
    : normalized === 'statement'
      ? 'statement'
      : undefined
}

function partitionStrategy(value: string): CatalogPartition['strategy'] {
  const normalized = value.toLowerCase()
  return normalized === 'range'
    ? 'range'
    : normalized === 'list'
      ? 'list'
      : normalized === 'hash'
        ? 'hash'
        : 'unknown'
}

function partitionKeyColumns(expression: string): readonly string[] {
  const values = expression
    .split(',')
    .map(value => value.trim())
    .filter(value => /^[A-Za-z_][A-Za-z0-9_$]*$/.test(value))
  return values
}

function sql(
  textValue: string,
  namespace: string,
  table: {
    readonly kind: CatalogReference['kind']
    readonly physicalName: string
    readonly reference?: CatalogReference
  },
  name: string
) {
  return {
    kind: 'sql' as const,
    dialect: 'mysql' as const,
    text: textValue,
    provenance: {
      kind: 'catalog' as const,
      dialect: 'mysql' as const,
      reference:
        table.reference ??
        reference(
          table.kind,
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
