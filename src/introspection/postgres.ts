import type { CatalogConnection } from './connection.ts'
import { createIntrospectionDiagnostic } from './diagnostics.ts'
import type {
  CatalogCheckConstraint,
  CatalogColumn,
  CatalogConstraint,
  CatalogData,
  CatalogDeferredObject,
  CatalogDialectExtension,
  CatalogDomain,
  CatalogEnum,
  CatalogEnumValue,
  CatalogExtensionObject,
  CatalogForeignKeyConstraint,
  CatalogIdentity,
  CatalogIndex,
  CatalogIndexTerm,
  CatalogLiteralFact,
  CatalogObjectReference,
  CatalogOpaqueObject,
  CatalogPartition,
  CatalogPolicy,
  CatalogPrimaryKeyConstraint,
  CatalogQueryRow,
  CatalogReference,
  CatalogRoutine,
  CatalogRoutineParameter,
  CatalogSequence,
  CatalogServerInfo,
  CatalogSqlExpression,
  CatalogStorageType,
  CatalogTable,
  CatalogTrigger,
  CatalogUniqueConstraint,
  CatalogValueFact,
  CatalogView,
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
  const relationObjects = relationRows.filter(row => {
    const kind = text(row.relkind)
    return kind !== 'i' && kind !== 'I'
  })
  const tables = relationObjects
    .filter(row => row.relkind === 'r' || row.relkind === 'p')
    .map(row => relationTable(row))
  const tableByOid = new Map(
    tables.map(table => [table.reference?.catalog?.value, table])
  )

  const viewRows = await query<PostgresViewRow>(
    connection,
    postgresViewsQuery,
    [options.namespace],
    options,
    diagnostics,
    'views'
  )
  const views: CatalogView[] = []
  for (const row of viewRows) {
    const view = viewObject(row, options.namespace, diagnostics)
    if (view.kind === 'deferred-object') {
      // A view whose definition cannot be recovered remains visible below in
      // the deferred collection. It must not become a fabricated SQL body.
      continue
    }
    views.push(view)
  }
  const relationReferences = new Map<
    string | number | undefined,
    CatalogObjectReference
  >()
  for (const table of tables) {
    relationReferences.set(table.reference?.catalog?.value, {
      kind: 'table',
      id: table.id,
    })
  }
  for (const view of views) {
    relationReferences.set(view.reference?.catalog?.value, {
      kind: view.kind,
      id: view.id,
    })
  }

  const columnRows = await query<PostgresColumnRow>(
    connection,
    postgresColumnsQuery,
    [options.namespace],
    options,
    diagnostics,
    'columns'
  )
  const identityRows = await query<PostgresIdentityRow>(
    connection,
    postgresIdentitiesQuery,
    [options.namespace],
    options,
    diagnostics,
    'identities'
  )
  const identityOptionsByColumn = new Map<
    string,
    Readonly<Record<string, CatalogValueFact>>
  >()
  for (const row of identityRows)
    identityOptionsByColumn.set(
      columnKey(row.table_oid, row.ordinal_position),
      identityOptions(row)
    )
  const columnsByTable = groupBy(columnRows, row => row.table_oid)
  for (const table of tables) {
    const rows = columnsByTable.get(table.reference?.catalog?.value) ?? []
    const columns = rows
      .sort(compareOrdinal)
      .map(row =>
        column(
          row,
          table,
          options.namespace,
          identityOptionsByColumn.get(
            columnKey(row.table_oid, row.ordinal_position)
          )
        )
      )
    ;(table as Mutable<CatalogTable>).columns = columns
  }
  for (const view of views) {
    const rows = columnsByTable.get(view.reference?.catalog?.value) ?? []
    ;(view as Mutable<CatalogView>).columns = rows
      .sort(compareOrdinal)
      .map(row => column(row, view, options.namespace))
  }

  const indexRows = await query<PostgresIndexRow>(
    connection,
    postgresIndexesQuery,
    [options.namespace],
    options,
    diagnostics,
    'indexes'
  )
  const indexReferences = new Map<string, CatalogEntityRecord>()
  for (const row of indexRows) {
    const indexOid = text(row.index_oid)
    const physicalName = text(row.physical_name)
    if (indexOid && physicalName)
      indexReferences.set(`pg_class:${indexOid}`, {
        kind: 'index',
        id: stableId(physicalName),
        physicalName,
        reference: reference(
          'index',
          physicalName,
          options.namespace,
          'pg_class',
          'oid',
          row.index_oid
        ),
      })
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
      (table.columns as readonly CatalogColumn[]).map(column => [
        column.ordinalPosition,
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
          diagnostics,
          indexReferences
        )
      )
      .filter((value): value is CatalogConstraint => value !== undefined)
    ;(table as Mutable<CatalogTable>).constraints = constraints
  }
  const indexesByTable = groupBy(indexRows, row => row.table_oid)
  for (const table of tables) {
    const rows = indexesByTable.get(table.reference?.catalog?.value) ?? []
    const columnsByNumber = new Map(
      (table.columns as readonly CatalogColumn[]).map(column => [
        column.ordinalPosition,
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

  const sequenceRows = await query<PostgresSequenceRow>(
    connection,
    postgresSequencesQuery,
    [options.namespace],
    options,
    diagnostics,
    'sequences'
  )
  const sequences = sequenceRows.map(row =>
    sequenceObject(row, options.namespace, tableByOid, diagnostics)
  )

  const enumRows = await query<PostgresEnumRow>(
    connection,
    postgresEnumsQuery,
    [options.namespace],
    options,
    diagnostics,
    'enums'
  )
  const enums = mapEnums(enumRows, options.namespace)

  const domainRows = await query<PostgresDomainRow>(
    connection,
    postgresDomainsQuery,
    [options.namespace],
    options,
    diagnostics,
    'domains'
  )
  const domainConstraintRows = await query<PostgresDomainConstraintRow>(
    connection,
    postgresDomainConstraintsQuery,
    [options.namespace],
    options,
    diagnostics,
    'domain-constraints'
  )
  const domains = mapDomains(
    domainRows,
    domainConstraintRows,
    options.namespace
  )

  const collationRows = await query<PostgresCollationRow>(
    connection,
    postgresCollationsQuery,
    [options.namespace],
    options,
    diagnostics,
    'collations'
  )
  const collations = collationRows.map(row =>
    collationObject(row, options.namespace)
  )

  const triggerRows = await query<PostgresTriggerRow>(
    connection,
    postgresTriggersQuery,
    [options.namespace],
    options,
    diagnostics,
    'triggers'
  )
  const triggers: CatalogTrigger[] = []
  const triggerDeferredObjects: CatalogDeferredObject[] = []
  for (const row of triggerRows) {
    const value = triggerObject(
      row,
      options.namespace,
      relationReferences,
      diagnostics
    )
    if (value.kind === 'deferred-object') triggerDeferredObjects.push(value)
    else triggers.push(value)
  }

  const routineRows = await query<PostgresRoutineRow>(
    connection,
    postgresRoutinesQuery,
    [options.namespace],
    options,
    diagnostics,
    'routines'
  )
  const routineParameterRows = await query<PostgresRoutineParameterRow>(
    connection,
    postgresRoutineParametersQuery,
    [options.namespace],
    options,
    diagnostics,
    'routine-parameters'
  )
  const routines = mapRoutines(
    routineRows,
    routineParameterRows,
    options.namespace,
    diagnostics
  )

  const partitionRows = await query<PostgresPartitionRow>(
    connection,
    postgresPartitionsQuery,
    [options.namespace],
    options,
    diagnostics,
    'partitions'
  )
  const partitions = partitionRows
    .map(row =>
      partitionObject(row, options.namespace, tableByOid, diagnostics)
    )
    .filter((value): value is CatalogPartition => value !== undefined)

  const policyRows = await query<PostgresPolicyRow>(
    connection,
    postgresPoliciesQuery,
    [options.namespace],
    options,
    diagnostics,
    'policies'
  )
  const policies = policyRows
    .map(row => policyObject(row, options.namespace, tableByOid, diagnostics))
    .filter((value): value is CatalogPolicy => value !== undefined)

  const extensionRows = await query<PostgresExtensionRow>(
    connection,
    postgresExtensionsQuery,
    [options.namespace],
    options,
    diagnostics,
    'extensions'
  )
  const extensionObjects = extensionRows.map(row =>
    extensionObject(row, options.namespace)
  )

  const typedRelationOids = new Set(
    [...views, ...sequences].map(object => object.reference?.catalog?.value)
  )
  const deferredObjects = relationObjects
    .filter(row => {
      const relkind = text(row.relkind)
      return (
        relkind === 'f' ||
        ((relkind === 'v' || relkind === 'm' || relkind === 'S') &&
          !typedRelationOids.has(
            row.oid === undefined ? undefined : text(row.oid)
          ))
      )
    })
    .map(row =>
      deferredObject(
        row,
        text(row.relkind) === 'f'
          ? 'foreign-table'
          : text(row.relkind) === 'v'
            ? 'view'
            : text(row.relkind) === 'm'
              ? 'materialized-view'
              : 'sequence'
      )
    )
  deferredObjects.push(...triggerDeferredObjects)
  const opaqueObjects = relationObjects
    .filter(row => {
      const kind = text(row.relkind)
      return (
        kind !== 'r' &&
        kind !== 'p' &&
        kind !== 'v' &&
        kind !== 'm' &&
        kind !== 'S' &&
        kind !== 'f'
      )
    })
    .map(row => opaqueRelationObject(row, options.namespace, diagnostics))

  const metadataRows = await query<PostgresMetadataRow>(
    connection,
    postgresMetadataQuery,
    [options.namespace],
    options,
    diagnostics,
    'comments-and-ownership'
  )
  const metadata = mapMetadataRows(
    metadataRows,
    options.namespace,
    tables,
    views,
    sequences,
    enums,
    domains,
    collations,
    routines,
    triggers,
    policies,
    extensionObjects,
    deferredObjects,
    opaqueObjects,
    indexReferences,
    relationReferences,
    diagnostics
  )
  opaqueObjects.push(...metadata.opaqueObjects)

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
    views: Object.freeze(views),
    sequences: Object.freeze(sequences),
    enums: Object.freeze(enums),
    domains: Object.freeze(domains),
    collations: Object.freeze(collations),
    triggers: Object.freeze(triggers),
    routines: Object.freeze(routines),
    partitions: Object.freeze(partitions),
    policies: Object.freeze(policies),
    extensionObjects: Object.freeze(extensionObjects),
    deferredObjects: Object.freeze(deferredObjects),
    opaqueObjects: Object.freeze(opaqueObjects),
    comments: Object.freeze(metadata.comments),
    ownership: Object.freeze(metadata.ownership),
    capabilities: server.capabilities,
    diagnostics: Object.freeze(diagnostics),
  })
}

export const postgresRelationsQuery = `
  SELECT c.oid::text AS oid, n.nspname AS namespace, c.relname,
         c.relkind, c.relispartition
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = $1
    AND c.relkind NOT IN ('i', 'I')
  ORDER BY c.relname
`

/** Fixed view and materialized-view definitions from PostgreSQL's decompiler. */
export const postgresViewsQuery = `
  SELECT c.oid::text AS oid, n.nspname AS namespace, c.relname AS physical_name,
         c.relkind, pg_get_viewdef(c.oid, true) AS definition,
         v.check_option, c.reloptions
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN information_schema.views v
    ON v.table_schema = n.nspname AND v.table_name = c.relname
  WHERE n.nspname = $1 AND c.relkind IN ('v', 'm')
  ORDER BY c.oid
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
    AND c.relkind IN ('r', 'p', 'v', 'm')
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
         con.conindid::text AS backing_index_oid,
         i.indnullsnotdistinct,
         pg_get_constraintdef(con.oid, true) AS definition
  FROM pg_constraint con
  JOIN pg_class c ON c.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_index i ON i.indexrelid = con.conindid
  WHERE n.nspname = $1
    AND con.contype IN ('p', 'u', 'f', 'c', 'x')
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
         opc.opcname AS operator_class,
         pg_get_indexdef(i.indexrelid, s.position, true) AS term_definition
  FROM pg_index i
  JOIN pg_class c ON c.oid = i.indexrelid
  JOIN pg_class t ON t.oid = i.indrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  JOIN pg_am am ON am.oid = c.relam
  CROSS JOIN LATERAL generate_series(1, i.indnatts) AS s(position)
  LEFT JOIN pg_opclass opc ON opc.oid = i.indclass[s.position]
  WHERE n.nspname = $1
  ORDER BY i.indrelid, i.indexrelid, s.position
`

/** Identity sequence options joined to each generated identity column. */
export const postgresIdentitiesQuery = `
  SELECT a.attrelid::text AS table_oid, a.attnum::int AS ordinal_position,
         s.seqstart, s.seqincrement, s.seqmin, s.seqmax, s.seqcache,
         s.seqcycle, format_type(s.seqtypid, -1) AS sequence_type
  FROM pg_catalog.pg_attribute a
  JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_catalog.pg_depend d
    ON d.refclassid = 'pg_catalog.pg_class'::regclass
   AND d.refobjid = a.attrelid AND d.refobjsubid = a.attnum
   AND d.classid = 'pg_catalog.pg_class'::regclass
   AND d.deptype = 'i'
  JOIN pg_catalog.pg_sequence s ON s.seqrelid = d.objid
  WHERE n.nspname = $1 AND a.attidentity <> ''
  ORDER BY a.attrelid, a.attnum
`

/** Sequence metadata, including serial/identity ownership dependencies. */
export const postgresSequencesQuery = `
  SELECT c.oid::text AS oid, n.nspname AS namespace, c.relname AS physical_name,
         format_type(s.seqtypid, -1) AS native_type,
         s.seqstart, s.seqincrement, s.seqmin, s.seqmax, s.seqcache,
         s.seqcycle, dep.refobjid::text AS owned_table_oid,
         dep.refobjsubid::int AS owned_column_position
  FROM pg_catalog.pg_sequence s
  JOIN pg_catalog.pg_class c ON c.oid = s.seqrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_catalog.pg_depend dep
    ON dep.classid = 'pg_catalog.pg_class'::regclass
   AND dep.objid = c.oid AND dep.refclassid = 'pg_catalog.pg_class'::regclass
   AND dep.deptype IN ('a', 'i')
  WHERE n.nspname = $1
  ORDER BY c.oid
`

/** PostgreSQL enum labels in their declared order. */
export const postgresEnumsQuery = `
  SELECT t.oid::text AS oid, n.nspname AS namespace,
         t.typname AS physical_name, e.oid::text AS value_oid,
         e.enumlabel AS value, e.enumsortorder::float8 AS ordinal_position
  FROM pg_catalog.pg_type t
  JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
  JOIN pg_catalog.pg_enum e ON e.enumtypid = t.oid
  WHERE n.nspname = $1 AND t.typtype = 'e'
  ORDER BY t.oid, e.enumsortorder
`

/** PostgreSQL domains and their exact base type/default metadata. */
export const postgresDomainsQuery = `
  SELECT t.oid::text AS oid, n.nspname AS namespace,
         t.typname AS physical_name,
         format_type(t.typbasetype, t.typtypmod) AS native_type,
         NOT t.typnotnull AS nullable, t.typdefault AS default_expression
  FROM pg_catalog.pg_type t
  JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname = $1 AND t.typtype = 'd'
  ORDER BY t.oid
`

/** Domain CHECK constraints, which use pg_constraint.contypid. */
export const postgresDomainConstraintsQuery = `
  SELECT con.oid::text AS oid, con.contypid::text AS domain_oid,
         con.conname AS physical_name, pg_get_constraintdef(con.oid, true) AS definition,
         con.condeferrable, con.condeferred, con.convalidated
  FROM pg_catalog.pg_constraint con
  JOIN pg_catalog.pg_type t ON t.oid = con.contypid
  JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname = $1 AND con.contype = 'c'
  ORDER BY con.contypid, con.oid
`

/** Collation provider, locale, determinism, and version facts. */
export const postgresCollationsQuery = `
  SELECT c.oid::text AS oid, n.nspname AS namespace,
         c.collname AS physical_name, c.collprovider, c.collcollate,
         c.collctype, to_jsonb(c)->>'colllocale' AS colliculocale,
         c.collisdeterministic, c.collversion
  FROM pg_catalog.pg_collation c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.collnamespace
  WHERE n.nspname = $1
  ORDER BY c.oid
`

/** User-defined triggers with decompiled condition and definition text. */
export const postgresTriggersQuery = `
  SELECT t.oid::text AS oid, t.tgrelid::text AS table_oid,
         n.nspname AS namespace, t.tgname AS physical_name,
         t.tgtype::int AS trigger_type, t.tgenabled,
         pg_get_expr(t.tgqual, t.tgrelid, true) AS condition,
         pg_get_triggerdef(t.oid, true) AS definition
  FROM pg_catalog.pg_trigger t
  JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = $1 AND NOT t.tgisinternal
  ORDER BY t.tgrelid, t.oid
`

/** PostgreSQL functions, procedures, aggregates, and window routines. */
export const postgresRoutinesQuery = `
  SELECT p.oid::text AS oid, n.nspname AS namespace,
         p.proname AS physical_name, p.prokind,
         format_type(p.prorettype, NULL) AS return_type,
         l.lanname AS language, pg_get_functiondef(p.oid) AS definition,
         pg_get_function_identity_arguments(p.oid) AS identity_arguments,
         pg_get_expr(p.proargdefaults, 0, true) AS argument_defaults,
         p.pronargdefaults, p.provolatile, p.proparallel, p.prosecdef
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_catalog.pg_language l ON l.oid = p.prolang
  WHERE n.nspname = $1 AND p.prokind IN ('f', 'p', 'a', 'w')
  ORDER BY p.oid
`

/** Routine parameter rows using PostgreSQL's complete argument type arrays. */
export const postgresRoutineParametersQuery = `
  SELECT p.oid::text AS routine_oid, x.position::int AS ordinal_position,
         names.name AS parameter_name, modes.mode,
         format_type(x.type_oid, -1) AS native_type
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN LATERAL unnest(
    COALESCE(p.proallargtypes, p.proargtypes::oid[])
  ) WITH ORDINALITY AS x(type_oid, position)
  LEFT JOIN LATERAL unnest(p.proargnames) WITH ORDINALITY
    AS names(name, position) ON names.position = x.position
  LEFT JOIN LATERAL unnest(p.proargmodes) WITH ORDINALITY
    AS modes(mode, position) ON modes.position = x.position
  WHERE n.nspname = $1 AND p.prokind IN ('f', 'p', 'a', 'w')
  ORDER BY p.oid, x.position
`

/** Partition children, key attributes, strategy, and bound expression. */
export const postgresPartitionsQuery = `
  SELECT child.oid::text AS partition_oid, parent.oid::text AS parent_oid,
         n.nspname AS namespace, child.relname AS physical_name,
         part.partstrat, part.partattrs::text AS key_attributes,
         pg_get_expr(child.relpartbound, child.oid, true) AS bound,
         child.relispartition, child.relkind
  FROM pg_catalog.pg_inherits inh
  JOIN pg_catalog.pg_class child ON child.oid = inh.inhrelid
  JOIN pg_catalog.pg_class parent ON parent.oid = inh.inhparent
  JOIN pg_catalog.pg_namespace n ON n.oid = child.relnamespace
  LEFT JOIN pg_catalog.pg_partitioned_table part ON part.partrelid = parent.oid
  WHERE n.nspname = $1
  ORDER BY parent.oid, child.oid
`

/** Row-level security policies and their role/expression metadata. */
export const postgresPoliciesQuery = `
  SELECT p.oid::text AS oid, p.polrelid::text AS table_oid,
         n.nspname AS namespace, p.polname AS physical_name,
         p.polcmd, p.polpermissive,
         ARRAY(SELECT r.rolname FROM pg_catalog.pg_roles r
               WHERE r.oid = ANY(p.polroles)) AS roles,
         pg_get_expr(p.polqual, p.polrelid, true) AS using_expression,
         pg_get_expr(p.polwithcheck, p.polrelid, true) AS check_expression
  FROM pg_catalog.pg_policy p
  JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = $1
  ORDER BY p.polrelid, p.oid
`

/** Installed PostgreSQL extensions scoped to the selected schema. */
export const postgresExtensionsQuery = `
  SELECT e.oid::text AS oid, n.nspname AS namespace,
         e.extname AS physical_name, e.extversion, e.extrelocatable,
         e.extconfig::text AS config_relations,
         e.extcondition::text AS config_conditions
  FROM pg_catalog.pg_extension e
  JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
  WHERE n.nspname = $1
  ORDER BY e.oid
`

/** Comments and owners for PostgreSQL objects visible in one schema. */
export const postgresMetadataQuery = `
  WITH objects AS (
    SELECT 'pg_class'::text AS catalog_relation, 'pg_class'::regclass AS catalog_oid,
           c.oid::text AS object_oid, 0::int AS object_subid,
           CASE c.relkind WHEN 'r' THEN 'table' WHEN 'p' THEN 'table'
             WHEN 'v' THEN 'view' WHEN 'm' THEN 'materialized-view'
             WHEN 'S' THEN 'sequence' WHEN 'i' THEN 'index'
             WHEN 'I' THEN 'index' WHEN 'f' THEN 'deferred-object'
             ELSE 'opaque-object' END AS object_kind,
           c.relname AS object_name, n.nspname AS namespace,
           c.relowner::oid AS owner_oid, NULL::text AS parent_oid
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = $1
    UNION ALL
    SELECT 'pg_class', 'pg_class'::regclass, c.oid::text, a.attnum::int,
           'column', a.attname, n.nspname, c.relowner::oid, c.oid::text
    FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = $1 AND c.relkind IN ('r', 'p', 'v', 'm')
      AND a.attnum > 0 AND NOT a.attisdropped
    UNION ALL
    SELECT 'pg_proc', 'pg_proc'::regclass, p.oid::text, 0,
           'routine', p.proname, n.nspname, p.proowner::oid, NULL
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = $1 AND p.prokind IN ('f', 'p', 'a', 'w')
    UNION ALL
    SELECT 'pg_type', 'pg_type'::regclass, t.oid::text, 0,
           CASE t.typtype WHEN 'e' THEN 'enum' ELSE 'domain' END,
           t.typname, n.nspname, t.typowner::oid, NULL
    FROM pg_catalog.pg_type t
    JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = $1 AND t.typtype IN ('e', 'd')
    UNION ALL
    SELECT 'pg_collation', 'pg_collation'::regclass, c.oid::text, 0,
           'collation', c.collname, n.nspname, c.collowner::oid, NULL
    FROM pg_catalog.pg_collation c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.collnamespace
    WHERE n.nspname = $1
    UNION ALL
    SELECT 'pg_extension', 'pg_extension'::regclass, e.oid::text, 0,
           'extension', e.extname, n.nspname, e.extowner::oid, NULL
    FROM pg_catalog.pg_extension e
    JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
    WHERE n.nspname = $1
    UNION ALL
    SELECT 'pg_constraint', 'pg_constraint'::regclass, con.oid::text, 0,
           'constraint', con.conname, n.nspname, c.relowner::oid,
           con.conrelid::text
    FROM pg_catalog.pg_constraint con
    JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = $1
    UNION ALL
    SELECT 'pg_trigger', 'pg_trigger'::regclass, t.oid::text, 0,
           'trigger', t.tgname, n.nspname, c.relowner::oid,
           t.tgrelid::text
    FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = $1 AND NOT t.tgisinternal
    UNION ALL
    SELECT 'pg_policy', 'pg_policy'::regclass, p.oid::text, 0,
           'policy', p.polname, n.nspname, c.relowner::oid,
           p.polrelid::text
    FROM pg_catalog.pg_policy p
    JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = $1
  )
  SELECT o.catalog_relation, o.object_oid, o.object_subid,
         o.object_kind, o.object_name, o.namespace, o.parent_oid,
         d.description, pg_get_userbyid(o.owner_oid) AS owner
  FROM objects o
  LEFT JOIN pg_catalog.pg_description d
    ON d.classoid = o.catalog_oid AND d.objoid::text = o.object_oid
   AND d.objsubid = o.object_subid
  ORDER BY o.catalog_relation, o.object_oid, o.object_subid
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

interface PostgresViewRow extends CatalogQueryRow {
  readonly oid?: unknown
  readonly namespace?: unknown
  readonly physical_name?: unknown
  readonly relkind?: unknown
  readonly definition?: unknown
  readonly check_option?: unknown
  readonly reloptions?: unknown
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

interface PostgresIdentityRow extends CatalogQueryRow {
  readonly table_oid?: unknown
  readonly ordinal_position?: unknown
  readonly seqstart?: unknown
  readonly seqincrement?: unknown
  readonly seqmin?: unknown
  readonly seqmax?: unknown
  readonly seqcache?: unknown
  readonly seqcycle?: unknown
  readonly sequence_type?: unknown
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
  readonly backing_index_oid?: unknown
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
  readonly operator_class?: unknown
  readonly term_definition?: unknown
}

interface PostgresSequenceRow extends CatalogQueryRow {
  readonly oid?: unknown
  readonly namespace?: unknown
  readonly physical_name?: unknown
  readonly native_type?: unknown
  readonly seqstart?: unknown
  readonly seqincrement?: unknown
  readonly seqmin?: unknown
  readonly seqmax?: unknown
  readonly seqcache?: unknown
  readonly seqcycle?: unknown
  readonly owned_table_oid?: unknown
  readonly owned_column_position?: unknown
}

interface PostgresEnumRow extends CatalogQueryRow {
  readonly oid?: unknown
  readonly namespace?: unknown
  readonly physical_name?: unknown
  readonly value_oid?: unknown
  readonly value?: unknown
  readonly ordinal_position?: unknown
}

interface PostgresDomainRow extends CatalogQueryRow {
  readonly oid?: unknown
  readonly namespace?: unknown
  readonly physical_name?: unknown
  readonly native_type?: unknown
  readonly nullable?: unknown
  readonly default_expression?: unknown
}

interface PostgresDomainConstraintRow extends CatalogQueryRow {
  readonly oid?: unknown
  readonly domain_oid?: unknown
  readonly physical_name?: unknown
  readonly definition?: unknown
  readonly condeferrable?: unknown
  readonly condeferred?: unknown
  readonly convalidated?: unknown
}

interface PostgresCollationRow extends CatalogQueryRow {
  readonly oid?: unknown
  readonly namespace?: unknown
  readonly physical_name?: unknown
  readonly collprovider?: unknown
  readonly collcollate?: unknown
  readonly collctype?: unknown
  readonly colliculocale?: unknown
  readonly collisdeterministic?: unknown
  readonly collversion?: unknown
}

interface PostgresTriggerRow extends CatalogQueryRow {
  readonly oid?: unknown
  readonly table_oid?: unknown
  readonly namespace?: unknown
  readonly physical_name?: unknown
  readonly trigger_type?: unknown
  readonly tgenabled?: unknown
  readonly condition?: unknown
  readonly definition?: unknown
}

interface PostgresRoutineRow extends CatalogQueryRow {
  readonly oid?: unknown
  readonly namespace?: unknown
  readonly physical_name?: unknown
  readonly prokind?: unknown
  readonly return_type?: unknown
  readonly language?: unknown
  readonly definition?: unknown
  readonly identity_arguments?: unknown
  readonly argument_defaults?: unknown
  readonly pronargdefaults?: unknown
  readonly provolatile?: unknown
  readonly proparallel?: unknown
  readonly prosecdef?: unknown
}

interface PostgresRoutineParameterRow extends CatalogQueryRow {
  readonly routine_oid?: unknown
  readonly ordinal_position?: unknown
  readonly parameter_name?: unknown
  readonly mode?: unknown
  readonly native_type?: unknown
}

interface PostgresPartitionRow extends CatalogQueryRow {
  readonly partition_oid?: unknown
  readonly parent_oid?: unknown
  readonly namespace?: unknown
  readonly physical_name?: unknown
  readonly partstrat?: unknown
  readonly key_attributes?: unknown
  readonly bound?: unknown
  readonly relispartition?: unknown
  readonly relkind?: unknown
}

interface PostgresPolicyRow extends CatalogQueryRow {
  readonly oid?: unknown
  readonly table_oid?: unknown
  readonly namespace?: unknown
  readonly physical_name?: unknown
  readonly polcmd?: unknown
  readonly polpermissive?: unknown
  readonly roles?: unknown
  readonly using_expression?: unknown
  readonly check_expression?: unknown
}

interface PostgresExtensionRow extends CatalogQueryRow {
  readonly oid?: unknown
  readonly namespace?: unknown
  readonly physical_name?: unknown
  readonly extversion?: unknown
  readonly extrelocatable?: unknown
  readonly config_relations?: unknown
  readonly config_conditions?: unknown
}

interface PostgresMetadataRow extends CatalogQueryRow {
  readonly catalog_relation?: unknown
  readonly object_oid?: unknown
  readonly object_subid?: unknown
  readonly object_kind?: unknown
  readonly object_name?: unknown
  readonly namespace?: unknown
  readonly parent_oid?: unknown
  readonly description?: unknown
  readonly owner?: unknown
}

interface CatalogEntityRecord {
  readonly kind: CatalogObjectReference['kind']
  readonly id: string
  readonly physicalName: string
  readonly reference?: CatalogReference
}

interface MetadataResult {
  readonly comments: readonly import('./types.ts').CatalogComment[]
  readonly ownership: readonly import('./types.ts').CatalogOwnership[]
  readonly opaqueObjects: readonly CatalogOpaqueObject[]
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

function viewObject(
  row: PostgresViewRow,
  namespace: string,
  diagnostics: IntrospectionCatalog['diagnostics'][number][]
): CatalogView | CatalogDeferredObject {
  const physicalName = text(row.physical_name) ?? 'unnamed_view'
  const kind = row.relkind === 'm' ? 'materialized-view' : 'view'
  const physicalReference = reference(
    kind,
    physicalName,
    text(row.namespace) ?? namespace,
    'pg_class',
    'oid',
    row.oid
  )
  const definition = text(row.definition)
  if (definition === undefined) {
    diagnostics.push(
      createIntrospectionDiagnostic({
        severity: 'warning',
        code: 'unmodeled-object',
        message: `PostgreSQL ${kind} ${physicalName} has no recoverable definition`,
        path: ['views', physicalName, 'definition'],
        physicalReference,
        remediation:
          'Grant access to pg_get_viewdef before treating this object as migration input.',
      })
    )
    return deferredCatalogObject(
      kind === 'view' ? 'view' : 'materialized-view',
      physicalName,
      physicalReference,
      [
        {
          name: 'definition',
          value: expression(
            '/* view definition unavailable */',
            'decompiler',
            physicalReference
          ),
        },
      ]
    )
  }
  const options = stringArray(row.reloptions)
  const checkOption: CatalogView['checkOption'] = (() => {
    const value = text(row.check_option)?.toLowerCase()
    return value === 'none' || value === 'local' || value === 'cascaded'
      ? value
      : undefined
  })()
  return {
    kind,
    id: stableId(physicalName),
    identitySource: 'physical-name',
    physicalName,
    columns: [],
    definition: expression(definition, 'decompiler', physicalReference),
    ...(checkOption === 'local' || checkOption === 'cascaded'
      ? { checkOption }
      : checkOption === 'none'
        ? { checkOption: 'none' as const }
        : {}),
    ...(booleanOption(options, 'security_barrier') === undefined
      ? {}
      : { securityBarrier: booleanOption(options, 'security_barrier') }),
    ...(booleanOption(options, 'security_invoker') === undefined
      ? {}
      : { securityInvoker: booleanOption(options, 'security_invoker') }),
    reference: physicalReference,
  }
}

function columnKey(tableOid: unknown, ordinalPosition: unknown): string {
  return `${text(tableOid) ?? 'unknown'}:${number(ordinalPosition) ?? 0}`
}

function compareOrdinal(
  left: PostgresColumnRow,
  right: PostgresColumnRow
): number {
  return (
    (number(left.ordinal_position) ?? 0) - (number(right.ordinal_position) ?? 0)
  )
}

function identityOptions(
  row: PostgresIdentityRow
): Readonly<Record<string, CatalogValueFact>> {
  const options: Record<string, CatalogValueFact> = {}
  for (const [key, value] of [
    ['start', row.seqstart],
    ['increment', row.seqincrement],
    ['minimum', row.seqmin],
    ['maximum', row.seqmax],
    ['cache', row.seqcache],
  ] as const) {
    const fact = literalFact(value)
    if (fact !== undefined) options[key] = fact
  }
  if (row.seqcycle !== undefined)
    options.cycle = {
      kind: 'literal',
      value: boolean(row.seqcycle),
    }
  if (text(row.sequence_type) !== undefined)
    options.type = {
      kind: 'literal',
      value: text(row.sequence_type) as string,
    }
  return options
}

function sequenceObject(
  row: PostgresSequenceRow,
  namespace: string,
  tableByOid: ReadonlyMap<string | number | undefined, CatalogTable>,
  diagnostics: IntrospectionCatalog['diagnostics'][number][]
): CatalogSequence {
  const physicalName =
    text(row.physical_name) ?? `sequence_${text(row.oid) ?? 'unknown'}`
  const physicalReference = reference(
    'sequence',
    physicalName,
    text(row.namespace) ?? namespace,
    'pg_class',
    'oid',
    row.oid
  )
  const ownedTable = tableByOid.get(text(row.owned_table_oid))
  const ownedBy = ownedTable
    ? ({
        kind: 'table' as const,
        id: ownedTable.id,
      } satisfies CatalogObjectReference)
    : undefined
  const ownedTableOid = text(row.owned_table_oid)
  const ownedColumnPosition = number(row.owned_column_position)
  if (ownedTableOid !== undefined && ownedBy === undefined) {
    diagnostics.push(
      createIntrospectionDiagnostic({
        severity: 'warning',
        code: 'unresolved-reference',
        message: `PostgreSQL sequence ${physicalName} has an ownership target outside the selected schema`,
        path: ['sequences', physicalName, 'ownedBy'],
        physicalReference,
        remediation:
          'Select the owning table schema or inspect the retained ownership catalog reference.',
      })
    )
  }
  const data: Record<string, CatalogData> = {}
  if (ownedTableOid !== undefined) data.ownedTableOid = ownedTableOid
  if (ownedColumnPosition !== undefined)
    data.ownedColumnPosition = ownedColumnPosition
  return {
    kind: 'sequence',
    id: stableId(physicalName),
    identitySource: 'physical-name',
    physicalName,
    storage: storage(row.native_type),
    ...(factIfPresent(row.seqstart) === undefined
      ? {}
      : { start: factIfPresent(row.seqstart) }),
    ...(factIfPresent(row.seqincrement) === undefined
      ? {}
      : { increment: factIfPresent(row.seqincrement) }),
    ...(factIfPresent(row.seqmin) === undefined
      ? {}
      : { minimum: factIfPresent(row.seqmin) }),
    ...(factIfPresent(row.seqmax) === undefined
      ? {}
      : { maximum: factIfPresent(row.seqmax) }),
    ...(factIfPresent(row.seqcache) === undefined
      ? {}
      : { cache: factIfPresent(row.seqcache) }),
    ...(row.seqcycle === undefined || row.seqcycle === null
      ? {}
      : { cycle: boolean(row.seqcycle) }),
    ...(ownedBy === undefined ? {} : { ownedBy }),
    ...(Object.keys(data).length === 0
      ? {}
      : {
          dialect: {
            dialect: 'postgresql' as const,
            version: 1,
            data,
          } satisfies CatalogDialectExtension,
        }),
    reference: physicalReference,
  }
}

function mapEnums(
  rows: readonly PostgresEnumRow[],
  namespace: string
): readonly CatalogEnum[] {
  const groups = new Map<string, PostgresEnumRow[]>()
  for (const row of rows) {
    const key = text(row.oid) ?? text(row.physical_name) ?? 'unknown'
    const values = groups.get(key) ?? []
    values.push(row)
    groups.set(key, values)
  }
  return [...groups.values()].map(enumRows => {
    const first = enumRows[0]!
    const physicalName =
      text(first.physical_name) ?? `enum_${text(first.oid) ?? 'unknown'}`
    const physicalReference = reference(
      'enum',
      physicalName,
      text(first.namespace) ?? namespace,
      'pg_type',
      'oid',
      first.oid
    )
    const values: CatalogEnumValue[] = [...enumRows]
      .sort(
        (left, right) =>
          (number(left.ordinal_position) ?? 0) -
          (number(right.ordinal_position) ?? 0)
      )
      .map((row, index) => ({
        value: text(row.value) ?? '',
        // pg_enum uses float4 so a label inserted between two existing labels
        // can have a fractional sort order. Snapshot v2 stores the observed
        // order as a canonical integer position and keeps the catalog OID in
        // provenance.
        ordinalPosition: index + 1,
        provenance: {
          kind: 'catalog' as const,
          dialect: 'postgresql' as const,
          reference: reference(
            'enum',
            physicalName,
            text(row.namespace) ?? namespace,
            'pg_enum',
            'oid',
            row.value_oid
          ),
        },
      }))
    return {
      kind: 'enum',
      id: stableId(physicalName),
      identitySource: 'physical-name',
      physicalName,
      values,
      reference: physicalReference,
    }
  })
}

function mapDomains(
  rows: readonly PostgresDomainRow[],
  constraintRows: readonly PostgresDomainConstraintRow[],
  namespace: string
): readonly CatalogDomain[] {
  const constraintsByDomain = groupBy(
    constraintRows,
    row => text(row.domain_oid) ?? 'unknown'
  )
  return rows.map(row => {
    const physicalName =
      text(row.physical_name) ?? `domain_${text(row.oid) ?? 'unknown'}`
    const physicalReference = reference(
      'domain',
      physicalName,
      text(row.namespace) ?? namespace,
      'pg_type',
      'oid',
      row.oid
    )
    const domainConstraints = (
      constraintsByDomain.get(text(row.oid)) ?? []
    ).map(constraintRow => {
      const constraintName =
        text(constraintRow.physical_name) ??
        `domain_constraint_${text(constraintRow.oid) ?? 'unknown'}`
      const constraintReference = reference(
        'constraint',
        constraintName,
        text(row.namespace) ?? namespace,
        'pg_constraint',
        'oid',
        constraintRow.oid
      )
      return {
        kind: 'check' as const,
        id: stableId(constraintName),
        identitySource: 'physical-name' as const,
        physicalName: constraintName,
        expression: expression(
          text(constraintRow.definition) ?? 'CHECK (true)',
          'decompiler',
          constraintReference
        ),
        deferrable:
          constraintRow.condeferrable === undefined
            ? undefined
            : boolean(constraintRow.condeferrable),
        initially:
          constraintRow.condeferred === undefined
            ? undefined
            : boolean(constraintRow.condeferred)
              ? ('deferred' as const)
              : ('immediate' as const),
        validated:
          constraintRow.convalidated === undefined
            ? undefined
            : boolean(constraintRow.convalidated),
        reference: constraintReference,
      } satisfies CatalogCheckConstraint
    })
    return {
      kind: 'domain',
      id: stableId(physicalName),
      identitySource: 'physical-name',
      physicalName,
      storage: storage(row.native_type),
      ...(row.nullable === undefined || row.nullable === null
        ? {}
        : { nullable: boolean(row.nullable) }),
      ...(factIfPresent(row.default_expression) === undefined
        ? {}
        : { default: factIfPresent(row.default_expression) }),
      ...(domainConstraints.length === 0
        ? {}
        : { constraints: domainConstraints }),
      reference: physicalReference,
    }
  })
}

function collationObject(
  row: PostgresCollationRow,
  namespace: string
): import('./types.ts').CatalogCollation {
  const physicalName =
    text(row.physical_name) ?? `collation_${text(row.oid) ?? 'unknown'}`
  return {
    kind: 'collation',
    id: stableId(physicalName),
    identitySource: 'physical-name',
    physicalName,
    ...(text(row.collprovider) === undefined
      ? {}
      : { provider: text(row.collprovider) }),
    ...((text(row.colliculocale) ??
      text(row.collcollate) ??
      text(row.collctype)) === undefined
      ? {}
      : {
          locale:
            text(row.colliculocale) ??
            text(row.collcollate) ??
            text(row.collctype),
        }),
    ...(row.collisdeterministic === undefined ||
    row.collisdeterministic === null
      ? {}
      : { deterministic: boolean(row.collisdeterministic) }),
    ...(text(row.collversion) === undefined
      ? {}
      : { version: text(row.collversion) }),
    reference: reference(
      'collation',
      physicalName,
      text(row.namespace) ?? namespace,
      'pg_collation',
      'oid',
      row.oid
    ),
  }
}

function triggerObject(
  row: PostgresTriggerRow,
  namespace: string,
  relationReferences: ReadonlyMap<
    string | number | undefined,
    CatalogObjectReference
  >,
  diagnostics: IntrospectionCatalog['diagnostics'][number][]
): CatalogTrigger | CatalogDeferredObject {
  const physicalName =
    text(row.physical_name) ?? `trigger_${text(row.oid) ?? 'unknown'}`
  const physicalReference = reference(
    'trigger',
    physicalName,
    text(row.namespace) ?? namespace,
    'pg_trigger',
    'oid',
    row.oid
  )
  const table = relationReferences.get(text(row.table_oid))
  const definition = text(row.definition)
  if (table === undefined || definition === undefined) {
    diagnostics.push(
      createIntrospectionDiagnostic({
        severity: 'warning',
        code: table === undefined ? 'unresolved-reference' : 'unmodeled-object',
        message:
          table === undefined
            ? `PostgreSQL trigger ${physicalName} has no selected parent relation`
            : `PostgreSQL trigger ${physicalName} has no recoverable definition`,
        path: ['triggers', physicalName],
        physicalReference,
        remediation:
          'Retain the deferred trigger until its parent relation and definition are visible.',
      })
    )
    return deferredCatalogObject('trigger', physicalName, physicalReference, [
      ...(table === undefined
        ? [
            {
              name: 'tableOid',
              value: text(row.table_oid) ?? 'unknown',
            },
          ]
        : []),
      ...(definition === undefined
        ? []
        : [
            {
              name: 'definition',
              value: expression(definition, 'decompiler', physicalReference),
            },
          ]),
    ])
  }
  const triggerType = number(row.trigger_type) ?? 0
  const timing =
    triggerType & 64 ? 'instead-of' : triggerType & 2 ? 'before' : 'after'
  const events = triggerEvents(triggerType)
  const mode = triggerType & 1 ? ('row' as const) : ('statement' as const)
  const enabled = triggerEnabled(row.tgenabled)
  return {
    kind: 'trigger',
    id: stableId(physicalName),
    identitySource: 'physical-name',
    physicalName,
    table,
    timing,
    events,
    orientation: mode,
    ...(text(row.condition) === undefined
      ? {}
      : {
          condition: expression(
            text(row.condition)!,
            'decompiler',
            physicalReference
          ),
        }),
    body: expression(definition, 'decompiler', physicalReference),
    ...(enabled === undefined ? {} : { enabled }),
    reference: physicalReference,
  }
}

function mapRoutines(
  rows: readonly PostgresRoutineRow[],
  parameterRows: readonly PostgresRoutineParameterRow[],
  namespace: string,
  diagnostics: IntrospectionCatalog['diagnostics'][number][]
): readonly CatalogRoutine[] {
  const parametersByRoutine = groupBy(
    parameterRows,
    row => text(row.routine_oid) ?? 'unknown'
  )
  const names = new Map<string, number>()
  for (const row of rows) {
    const name =
      text(row.physical_name) ?? `routine_${text(row.oid) ?? 'unknown'}`
    names.set(name, (names.get(name) ?? 0) + 1)
  }
  return rows.map(row => {
    const physicalName =
      text(row.physical_name) ?? `routine_${text(row.oid) ?? 'unknown'}`
    const physicalReference = reference(
      'routine',
      physicalName,
      text(row.namespace) ?? namespace,
      'pg_proc',
      'oid',
      row.oid
    )
    const identityArguments = text(row.identity_arguments)
    const defaultArguments = text(row.argument_defaults)
    if (defaultArguments !== undefined) {
      diagnostics.push(
        createIntrospectionDiagnostic({
          severity: 'info',
          code: 'unmodeled-object',
          message: `PostgreSQL routine ${physicalName} retains its argument defaults as opaque catalog text`,
          path: ['routines', physicalName, 'argumentDefaults'],
          physicalReference,
          remediation:
            'Review routine argument defaults before using the complete snapshot for migration planning.',
        })
      )
    }
    if (text(row.definition) === undefined) {
      diagnostics.push(
        createIntrospectionDiagnostic({
          severity: 'warning',
          code: 'unmodeled-object',
          message: `PostgreSQL routine ${physicalName} has no recoverable definition`,
          path: ['routines', physicalName, 'definition'],
          physicalReference,
          remediation:
            'Grant access to pg_get_functiondef before treating this routine as migration input.',
        })
      )
    }
    const routineUnknownFields = [
      ...(identityArguments === undefined
        ? []
        : [
            {
              name: 'identityArguments',
              value: expression(
                identityArguments,
                'decompiler',
                physicalReference
              ),
            },
          ]),
      ...(defaultArguments === undefined
        ? []
        : [
            {
              name: 'argumentDefaults',
              value: expression(
                defaultArguments,
                'decompiler',
                physicalReference
              ),
            },
          ]),
    ]
    const parameters = (parametersByRoutine.get(text(row.oid)) ?? [])
      .sort(
        (left, right) =>
          (number(left.ordinal_position) ?? 0) -
          (number(right.ordinal_position) ?? 0)
      )
      .map(parameter => ({
        ...(text(parameter.parameter_name) === undefined
          ? {}
          : { name: text(parameter.parameter_name) }),
        ...(routineParameterMode(parameter.mode) === undefined
          ? {}
          : { mode: routineParameterMode(parameter.mode) }),
        storage: storage(parameter.native_type),
        ordinalPosition: number(parameter.ordinal_position) ?? 0,
        provenance: {
          kind: 'catalog' as const,
          dialect: 'postgresql' as const,
          reference: physicalReference,
        },
      }))
    return {
      kind: 'routine',
      id: stableId(
        (names.get(physicalName) ?? 0) < 2 || identityArguments === undefined
          ? physicalName
          : `${physicalName}_${identityArguments.replace(/[^a-zA-Z0-9_]+/g, '_')}`
      ),
      identitySource: 'physical-name',
      physicalName,
      routineKind: routineKind(row.prokind),
      parameters,
      ...(text(row.return_type) === undefined
        ? {}
        : { returnType: storage(row.return_type) }),
      ...(text(row.language) === undefined
        ? {}
        : { language: text(row.language) }),
      ...(text(row.definition) === undefined
        ? {}
        : {
            body: expression(
              text(row.definition)!,
              'decompiler',
              physicalReference
            ),
          }),
      ...(routineVolatility(row.provolatile) === undefined
        ? {}
        : { volatility: routineVolatility(row.provolatile) }),
      ...(routineParallel(row.proparallel) === undefined
        ? {}
        : { parallel: routineParallel(row.proparallel) }),
      ...(row.prosecdef === undefined || row.prosecdef === null
        ? {}
        : {
            security: boolean(row.prosecdef)
              ? ('definer' as const)
              : ('invoker' as const),
          }),
      ...(routineUnknownFields.length === 0
        ? {}
        : { unknownFields: routineUnknownFields }),
      reference: physicalReference,
    }
  })
}

function partitionObject(
  row: PostgresPartitionRow,
  namespace: string,
  tableByOid: ReadonlyMap<string | number | undefined, CatalogTable>,
  diagnostics: IntrospectionCatalog['diagnostics'][number][]
): CatalogPartition {
  const physicalName =
    text(row.physical_name) ??
    `partition_${text(row.partition_oid) ?? 'unknown'}`
  const physicalReference = reference(
    'partition',
    physicalName,
    text(row.namespace) ?? namespace,
    'pg_class',
    'oid',
    row.partition_oid
  )
  const parent = tableByOid.get(text(row.parent_oid))
  if (parent === undefined) {
    diagnostics.push(
      createIntrospectionDiagnostic({
        severity: 'error',
        code: 'unresolved-reference',
        message: `PostgreSQL partition ${physicalName} has no parent table in the selected schema`,
        path: ['partitions', physicalName, 'parent'],
        physicalReference,
        remediation:
          'Select the parent table schema before mapping partitions.',
      })
    )
  }
  const parentReference = parent
    ? ({
        kind: 'table' as const,
        id: parent.id,
      } satisfies CatalogObjectReference)
    : ({
        kind: 'table' as const,
        id: stableId(`missing_parent_${text(row.parent_oid) ?? 'unknown'}`),
      } satisfies CatalogObjectReference)
  const keyColumns = partitionKeyColumns(
    row.key_attributes,
    parent?.columns ?? []
  )
  const bound = text(row.bound)
  return {
    kind: 'partition',
    id: stableId(physicalName),
    identitySource: 'physical-name',
    physicalName,
    parent: parentReference,
    strategy: partitionStrategy(row.partstrat),
    ...(keyColumns.length === 0 ? {} : { keyColumns }),
    ...(bound === undefined
      ? {}
      : { bound: expression(bound, 'decompiler', physicalReference) }),
    ...(bound !== undefined && /^default$/i.test(bound.trim())
      ? { default: true }
      : {}),
    reference: physicalReference,
  }
}

function policyObject(
  row: PostgresPolicyRow,
  namespace: string,
  tableByOid: ReadonlyMap<string | number | undefined, CatalogTable>,
  diagnostics: IntrospectionCatalog['diagnostics'][number][]
): CatalogPolicy {
  const physicalName =
    text(row.physical_name) ?? `policy_${text(row.oid) ?? 'unknown'}`
  const physicalReference = reference(
    'policy',
    physicalName,
    text(row.namespace) ?? namespace,
    'pg_policy',
    'oid',
    row.oid
  )
  const table = tableByOid.get(text(row.table_oid))
  if (table === undefined)
    diagnostics.push(
      createIntrospectionDiagnostic({
        severity: 'error',
        code: 'unresolved-reference',
        message: `PostgreSQL policy ${physicalName} has no selected table`,
        path: ['policies', physicalName, 'table'],
        physicalReference,
        remediation:
          'Select the policy table schema before mapping row-level security.',
      })
    )
  return {
    kind: 'policy',
    id: stableId(physicalName),
    identitySource: 'physical-name',
    physicalName,
    table: table
      ? ({
          kind: 'table' as const,
          id: table.id,
        } satisfies CatalogObjectReference)
      : ({
          kind: 'table' as const,
          id: stableId(`missing_table_${text(row.table_oid) ?? 'unknown'}`),
        } satisfies CatalogObjectReference),
    command: policyCommand(row.polcmd),
    ...(stringArray(row.roles).length === 0
      ? {}
      : { roles: stringArray(row.roles) }),
    ...(row.polpermissive === undefined || row.polpermissive === null
      ? {}
      : { permissive: boolean(row.polpermissive) }),
    ...(text(row.using_expression) === undefined
      ? {}
      : {
          using: expression(
            text(row.using_expression)!,
            'decompiler',
            physicalReference
          ),
        }),
    ...(text(row.check_expression) === undefined
      ? {}
      : {
          check: expression(
            text(row.check_expression)!,
            'decompiler',
            physicalReference
          ),
        }),
    reference: physicalReference,
  }
}

function extensionObject(
  row: PostgresExtensionRow,
  namespace: string
): CatalogExtensionObject {
  const physicalName =
    text(row.physical_name) ?? `extension_${text(row.oid) ?? 'unknown'}`
  const physicalReference = reference(
    'extension',
    physicalName,
    text(row.namespace) ?? namespace,
    'pg_extension',
    'oid',
    row.oid
  )
  const data: Record<string, CatalogData> = {
    relocatable: boolean(row.extrelocatable),
  }
  const configuration: Record<string, CatalogData> = {}
  if (text(row.config_relations) !== undefined)
    configuration.relations = text(row.config_relations)!
  if (text(row.config_conditions) !== undefined)
    configuration.conditions = text(row.config_conditions)!
  return {
    kind: 'extension',
    id: stableId(physicalName),
    identitySource: 'physical-name',
    physicalName,
    extensionName: physicalName,
    ...(text(row.extversion) === undefined
      ? {}
      : { extensionVersion: text(row.extversion) }),
    ...(text(row.namespace) === undefined
      ? {}
      : { schema: text(row.namespace) }),
    data,
    ...(Object.keys(configuration).length === 0 ? {} : { configuration }),
    dialect: {
      dialect: 'postgresql',
      version: 1,
      data: { relocatable: boolean(row.extrelocatable) },
    },
    reference: physicalReference,
  }
}

function deferredCatalogObject(
  objectKind: CatalogDeferredObject['objectKind'],
  physicalName: string,
  physicalReference: CatalogReference,
  unknownFields: CatalogDeferredObject['unknownFields'] = []
): CatalogDeferredObject {
  return {
    kind: 'deferred-object',
    objectKind,
    id: stableId(`deferred_${objectKind}_${physicalName}`),
    identitySource: 'physical-name',
    physicalName,
    reference: physicalReference,
    ...(unknownFields.length === 0 ? {} : { unknownFields }),
  }
}

function triggerEvents(
  triggerType: number
): readonly ('insert' | 'update' | 'delete' | 'truncate')[] {
  const events: ('insert' | 'update' | 'delete' | 'truncate')[] = []
  if (triggerType & 4) events.push('insert')
  if (triggerType & 8) events.push('delete')
  if (triggerType & 16) events.push('update')
  if (triggerType & 32) events.push('truncate')
  return events.sort()
}

function triggerEnabled(value: unknown): boolean | undefined {
  const code = text(value)?.toUpperCase()
  if (code === 'D') return false
  if (code === 'O' || code === 'R' || code === 'A') return true
  return undefined
}

function routineKind(value: unknown): CatalogRoutine['routineKind'] {
  return (
    (
      {
        f: 'function',
        p: 'procedure',
        a: 'aggregate',
        w: 'window',
      } as const
    )[text(value) as 'f' | 'p' | 'a' | 'w'] ?? 'unknown'
  )
}

function routineParameterMode(value: unknown): CatalogRoutineParameter['mode'] {
  return (
    {
      i: 'in',
      o: 'out',
      b: 'inout',
      v: 'variadic',
      t: 'table',
    } as const
  )[text(value) as 'i' | 'o' | 'b' | 'v' | 't']
}

function routineVolatility(value: unknown): CatalogRoutine['volatility'] {
  return ({ i: 'immutable', s: 'stable', v: 'volatile' } as const)[
    text(value) as 'i' | 's' | 'v'
  ]
}

function routineParallel(value: unknown): CatalogRoutine['parallel'] {
  return ({ s: 'safe', r: 'restricted', u: 'unsafe' } as const)[
    text(value) as 's' | 'r' | 'u'
  ]
}

function partitionStrategy(value: unknown): CatalogPartition['strategy'] {
  return (
    ({ r: 'range', l: 'list', h: 'hash' } as const)[
      text(value) as 'r' | 'l' | 'h'
    ] ?? 'unknown'
  )
}

function partitionKeyColumns(
  value: unknown,
  columns: readonly CatalogColumn[]
): readonly string[] {
  const byOrdinal = new Map(
    columns.map(column => [column.ordinalPosition, column.physicalName])
  )
  return integerArray(value)
    .filter(position => position > 0)
    .map(position => byOrdinal.get(position) ?? `attnum_${position}`)
}

function policyCommand(value: unknown): CatalogPolicy['command'] {
  return (
    (
      {
        '*': 'all',
        r: 'select',
        a: 'insert',
        w: 'update',
        d: 'delete',
      } as const
    )[text(value) as '*' | 'r' | 'a' | 'w' | 'd'] ?? 'unknown'
  )
}

function storage(value: unknown): CatalogStorageType {
  return { nativeType: text(value) ?? 'unknown' }
}

function factIfPresent(
  value: unknown
): CatalogLiteralFact | CatalogValueFact | undefined {
  if (value === undefined || value === null) return undefined
  return literalFact(value)
}

function literalFact(value: unknown): CatalogLiteralFact | undefined {
  if (value === undefined) return undefined
  if (value === null) return { kind: 'literal', value: null }
  if (typeof value === 'boolean') return { kind: 'literal', value }
  if (typeof value === 'bigint') return { kind: 'literal', value }
  if (typeof value === 'number')
    return Number.isFinite(value)
      ? { kind: 'literal', value }
      : { kind: 'literal', value: String(value) }
  const textValue = String(value)
  if (/^[+-]?\d+$/.test(textValue.trim())) {
    try {
      const integerValue = BigInt(textValue)
      if (
        integerValue > BigInt(Number.MAX_SAFE_INTEGER) ||
        integerValue < BigInt(Number.MIN_SAFE_INTEGER)
      )
        return { kind: 'literal', value: integerValue }
    } catch {
      // Keep a driver value that is not a valid integer as catalog text.
    }
  }
  const numericValue = Number(textValue)
  return textValue.trim() !== '' && Number.isFinite(numericValue)
    ? { kind: 'literal', value: numericValue }
    : { kind: 'literal', value: textValue }
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
    unknownFields: boolean(row.relispartition)
      ? [{ name: 'partitioned', value: true }]
      : undefined,
  }
}

function deferredObject(
  row: PostgresRelationRow,
  objectKind: CatalogDeferredObject['objectKind'] = 'other'
): CatalogDeferredObject {
  const physicalName = text(row.relname) ?? 'unnamed_object'
  return {
    kind: 'deferred-object',
    objectKind,
    id: stableId(`deferred:${objectKind}:${physicalName}`),
    identitySource: 'physical-name',
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

function opaqueRelationObject(
  row: PostgresRelationRow,
  namespace: string,
  diagnostics: IntrospectionCatalog['diagnostics'][number][]
): CatalogOpaqueObject {
  const physicalName = text(row.relname) ?? 'unnamed_object'
  const relkind = text(row.relkind) ?? 'unknown'
  const physicalReference = reference(
    'opaque-object',
    physicalName,
    text(row.namespace) ?? namespace,
    'pg_class',
    'oid',
    row.oid
  )
  diagnostics.push(
    createIntrospectionDiagnostic({
      severity: 'warning',
      code: 'unmodeled-object',
      message: `PostgreSQL relation ${physicalName} (${relkind}) was retained as an opaque object`,
      path: ['opaqueObjects', physicalName],
      physicalReference,
      remediation:
        'Inspect the opaque object before treating it as migration input.',
    })
  )
  return {
    kind: 'opaque-object',
    id: stableId(`relation:${relkind}:${physicalName}`),
    identitySource: 'physical-name',
    physicalName,
    objectKind: `postgres-relation:${relkind}`,
    data: {
      relkind,
      relispartition: boolean(row.relispartition),
    },
    reference: physicalReference,
  }
}

function column(
  row: PostgresColumnRow,
  table: CatalogTable | CatalogView,
  namespace: string,
  identityOptionValues?: Readonly<Record<string, CatalogValueFact>>
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
          options: identityOptionValues ?? {},
        }
      : undefined
  const generated: CatalogColumn['generated'] =
    (generatedValue === 's' || generatedValue === 'v') && defaultExpression
      ? {
          kind: 'generated',
          mode: generatedValue === 's' ? 'stored' : 'virtual',
          expression: sql(defaultExpression, namespace, table, physicalName),
        }
      : undefined
  const ordinaryDefault: CatalogColumn['default'] =
    defaultExpression && !identity && !generated
      ? {
          kind: 'expression',
          expression: sql(defaultExpression, namespace, table, physicalName),
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
    ...(ordinaryDefault ? { default: ordinaryDefault } : {}),
    ...(generated ? { generated } : {}),
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
  diagnostics: IntrospectionCatalog['diagnostics'][number][],
  indexReferences: ReadonlyMap<string, CatalogEntityRecord>
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
  const backingOid = text(row.backing_index_oid)
  const backing = backingOid
    ? indexReferences.get(`pg_class:${backingOid}`)
    : undefined
  const backingIndex = backing
    ? ({ kind: 'index', id: backing.id } satisfies CatalogObjectReference)
    : undefined
  if (kind === 'p')
    return {
      kind: 'primary-key',
      ...common,
      columns,
      ...(backingIndex === undefined ? {} : { backingIndex }),
    } satisfies CatalogPrimaryKeyConstraint
  if (kind === 'u') {
    return {
      kind: 'unique',
      ...common,
      columns,
      nulls: boolean(row.indnullsnotdistinct) ? 'not-distinct' : 'distinct',
      ...(backingIndex === undefined ? {} : { backingIndex }),
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
    const targetColumn = (targetTable.columns as readonly CatalogColumn[]).find(
      column => column.ordinalPosition === numberValue
    )
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
    const orderedRows = [...indexRows].sort(
      (left, right) =>
        (number(left.position) ?? 0) - (number(right.position) ?? 0)
    )
    const first = orderedRows[0]
    const physicalName =
      text(first.physical_name) ?? `index_${text(first.index_oid) ?? 'unknown'}`
    const keyCount = number(first.indnkeyatts) ?? indexRows.length
    const terms: CatalogIndexTerm[] = []
    const includedColumns: string[] = []
    for (const row of orderedRows) {
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
              ...(text(row.operator_class) === undefined
                ? {}
                : { operatorClass: text(row.operator_class) }),
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
              ...(text(row.operator_class) === undefined
                ? {}
                : { operatorClass: text(row.operator_class) }),
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

interface MetadataTarget {
  readonly object: CatalogObjectReference
  readonly reference: CatalogReference
  readonly physicalName: string
}

function mapMetadataRows(
  rows: readonly PostgresMetadataRow[],
  namespace: string,
  tables: readonly CatalogTable[],
  views: readonly CatalogView[],
  sequences: readonly CatalogSequence[],
  enums: readonly CatalogEnum[],
  domains: readonly CatalogDomain[],
  collations: readonly import('./types.ts').CatalogCollation[],
  routines: readonly CatalogRoutine[],
  triggers: readonly CatalogTrigger[],
  policies: readonly CatalogPolicy[],
  extensions: readonly CatalogExtensionObject[],
  deferredObjects: readonly CatalogDeferredObject[],
  opaqueObjects: readonly CatalogOpaqueObject[],
  indexReferences: ReadonlyMap<string, CatalogEntityRecord>,
  relationReferences: ReadonlyMap<
    string | number | undefined,
    CatalogObjectReference
  >,
  diagnostics: IntrospectionCatalog['diagnostics'][number][]
): MetadataResult {
  const targets = new Map<string, MetadataTarget>()
  const add = (
    relation: string,
    oid: unknown,
    object: CatalogObjectReference,
    physicalName: string,
    objectReference?: CatalogReference
  ): void => {
    const ref =
      objectReference ??
      reference(object.kind, physicalName, namespace, relation, 'oid', oid)
    targets.set(metadataKey(relation, oid, 0), {
      object,
      reference: ref,
      physicalName,
    })
  }
  for (const table of tables)
    if (table.reference?.catalog !== undefined)
      add(
        'pg_class',
        table.reference.catalog.value,
        { kind: 'table', id: table.id },
        table.physicalName,
        table.reference
      )
  for (const view of views)
    if (view.reference?.catalog !== undefined)
      add(
        'pg_class',
        view.reference.catalog.value,
        { kind: view.kind, id: view.id },
        view.physicalName,
        view.reference
      )
  for (const sequence of sequences)
    if (sequence.reference?.catalog !== undefined)
      add(
        'pg_class',
        sequence.reference.catalog.value,
        { kind: 'sequence', id: sequence.id },
        sequence.physicalName,
        sequence.reference
      )
  for (const deferred of deferredObjects)
    if (deferred.reference?.catalog !== undefined && deferred.id !== undefined)
      add(
        'pg_class',
        deferred.reference.catalog.value,
        { kind: 'deferred-object', id: deferred.id },
        deferred.physicalName,
        deferred.reference
      )
  for (const opaque of opaqueObjects)
    if (opaque.reference?.catalog !== undefined)
      add(
        'pg_class',
        opaque.reference.catalog.value,
        { kind: 'opaque-object', id: opaque.id },
        opaque.physicalName,
        opaque.reference
      )
  for (const index of indexReferences.values())
    if (index.reference?.catalog !== undefined)
      add(
        'pg_class',
        index.reference.catalog.value,
        { kind: 'index', id: index.id },
        index.physicalName,
        index.reference
      )
  for (const enumObject of enums)
    if (enumObject.reference?.catalog !== undefined)
      add(
        'pg_type',
        enumObject.reference.catalog.value,
        { kind: 'enum', id: enumObject.id },
        enumObject.physicalName,
        enumObject.reference
      )
  for (const domain of domains)
    if (domain.reference?.catalog !== undefined)
      add(
        'pg_type',
        domain.reference.catalog.value,
        { kind: 'domain', id: domain.id },
        domain.physicalName,
        domain.reference
      )
  for (const collation of collations)
    if (collation.reference?.catalog !== undefined)
      add(
        'pg_collation',
        collation.reference.catalog.value,
        { kind: 'collation', id: collation.id },
        collation.physicalName,
        collation.reference
      )
  for (const routine of routines)
    if (routine.reference?.catalog !== undefined)
      add(
        'pg_proc',
        routine.reference.catalog.value,
        { kind: 'routine', id: routine.id },
        routine.physicalName,
        routine.reference
      )
  for (const trigger of triggers)
    if (trigger.reference?.catalog !== undefined)
      add(
        'pg_trigger',
        trigger.reference.catalog.value,
        { kind: 'trigger', id: trigger.id },
        trigger.physicalName,
        trigger.reference
      )
  for (const policy of policies)
    if (policy.reference?.catalog !== undefined)
      add(
        'pg_policy',
        policy.reference.catalog.value,
        { kind: 'policy', id: policy.id },
        policy.physicalName,
        policy.reference
      )
  for (const extension of extensions)
    if (extension.reference?.catalog !== undefined)
      add(
        'pg_extension',
        extension.reference.catalog.value,
        { kind: 'extension', id: extension.id },
        extension.physicalName,
        extension.reference
      )
  for (const table of tables)
    addNestedColumns(targets, 'pg_class', table, namespace)
  for (const view of views)
    addNestedColumns(targets, 'pg_class', view, namespace)
  for (const table of tables) {
    for (const constraint of table.constraints)
      if (constraint.reference?.catalog !== undefined)
        targets.set(
          metadataKey('pg_constraint', constraint.reference.catalog.value, 0),
          {
            object: { kind: 'constraint', id: constraint.id },
            reference: constraint.reference,
            physicalName: constraint.physicalName ?? constraint.id,
          }
        )
  }
  for (const domain of domains)
    for (const constraint of domain.constraints ?? [])
      if (constraint.reference?.catalog !== undefined)
        targets.set(
          metadataKey('pg_constraint', constraint.reference.catalog.value, 0),
          {
            object: { kind: 'constraint', id: constraint.id },
            reference: constraint.reference,
            physicalName: constraint.physicalName ?? constraint.id,
          }
        )
  // Trigger and policy rows can be commented on even when the server exposes
  // them through a catalog relation that is not part of pg_class.
  void relationReferences

  const comments: import('./types.ts').CatalogComment[] = []
  const ownership: import('./types.ts').CatalogOwnership[] = []
  const opaque: CatalogOpaqueObject[] = []
  for (const [index, row] of rows.entries()) {
    const relation = text(row.catalog_relation) ?? 'unknown'
    const oid = text(row.object_oid)
    const subid = number(row.object_subid) ?? 0
    const target = targets.get(metadataKey(relation, oid, subid))
    if (target === undefined) {
      const unknownReference = reference(
        'opaque-object',
        text(row.object_name) ?? `metadata_${oid ?? 'unknown'}`,
        text(row.namespace) ?? namespace,
        relation,
        'oid',
        oid
      )
      diagnostics.push(
        createIntrospectionDiagnostic({
          severity: 'warning',
          code: 'unmodeled-object',
          message: `PostgreSQL metadata row for ${text(row.object_name) ?? 'unknown object'} could not be attached to a normalized object`,
          path: ['metadata', index],
          physicalReference: unknownReference,
          remediation:
            'Inspect the retained opaque metadata record before using it as migration input.',
        })
      )
      opaque.push({
        kind: 'opaque-object',
        id: stableId(`metadata_${relation}_${oid ?? 'unknown'}_${subid}`),
        identitySource: 'physical-name',
        physicalName: text(row.object_name) ?? `metadata_${oid ?? 'unknown'}`,
        objectKind: `postgres-metadata:${text(row.object_kind) ?? 'unknown'}`,
        data: {
          catalogRelation: relation,
          objectOid: oid ?? 'unknown',
          objectSubid: subid,
          ...(text(row.description) === undefined
            ? {}
            : { description: text(row.description) }),
          ...(text(row.owner) === undefined ? {} : { owner: text(row.owner) }),
        },
        reference: unknownReference,
      })
      continue
    }
    const description = text(row.description)
    if (description !== undefined)
      comments.push({
        kind: 'comment',
        id: stableId(`${target.object.kind}_${target.object.id}_comment`),
        object: target.object,
        text: description,
        reference: target.reference,
        provenance: {
          kind: 'catalog',
          dialect: 'postgresql',
          reference: target.reference,
        },
      })
    const owner = text(row.owner)
    if (owner !== undefined)
      ownership.push({
        kind: 'ownership',
        id: stableId(`${target.object.kind}_${target.object.id}_ownership`),
        object: target.object,
        owner,
        reference: target.reference,
        provenance: {
          kind: 'catalog',
          dialect: 'postgresql',
          reference: target.reference,
        },
      })
  }
  return {
    comments,
    ownership,
    opaqueObjects: opaque,
  }
}

function addNestedColumns(
  targets: Map<string, MetadataTarget>,
  relation: string,
  owner: CatalogTable | CatalogView,
  namespace: string
): void {
  const tableOid = owner.reference?.catalog?.value
  if (tableOid === undefined) return
  for (const column of owner.columns) {
    targets.set(metadataKey(relation, tableOid, column.ordinalPosition), {
      object: { kind: 'column', id: column.id },
      reference:
        column.reference ??
        reference(
          'column',
          column.physicalName,
          namespace,
          'pg_attribute',
          'attrelid',
          tableOid
        ),
      physicalName: column.physicalName,
    })
  }
}

function metadataKey(relation: string, oid: unknown, subid: unknown): string {
  return `${relation}:${text(oid) ?? 'unknown'}:${number(subid) ?? 0}`
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
  owner: CatalogTable | CatalogView,
  name: string
) {
  return expression(
    textValue,
    'decompiler',
    owner.reference ??
      reference(
        'table',
        name,
        namespace,
        'pg_class',
        'relname',
        owner.physicalName
      )
  )
}

function expression(
  textValue: string,
  provenanceKind: 'catalog' | 'decompiler' | 'create-sql',
  physicalReference?: CatalogReference
): CatalogSqlExpression {
  return {
    kind: 'sql',
    dialect: 'postgresql',
    text: textValue,
    provenance: {
      kind: provenanceKind,
      dialect: 'postgresql',
      ...(physicalReference === undefined
        ? {}
        : { reference: physicalReference }),
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

function stringArray(value: unknown): string[] {
  if (Array.isArray(value))
    return value
      .map(item => text(item))
      .filter((item): item is string => item !== undefined)
  const source = text(value)?.trim()
  if (source === undefined || source === '') return []
  if (source.startsWith('{') && source.endsWith('}')) {
    const values: string[] = []
    let current = ''
    let quoted = false
    let escaped = false
    for (const character of source.slice(1, -1)) {
      if (escaped) {
        current += character
        escaped = false
      } else if (character === '\\' && quoted) escaped = true
      else if (character === '"') quoted = !quoted
      else if (character === ',' && !quoted) {
        values.push(current)
        current = ''
      } else current += character
    }
    if (current !== '' || source !== '{}') values.push(current)
    return values.filter(value => value !== '')
  }
  return source
    .split(',')
    .map(item => item.trim())
    .filter(item => item !== '')
}

function booleanOption(
  options: readonly string[],
  name: string
): boolean | undefined {
  const value = options.find(option => option.startsWith(`${name}=`))
  if (value === undefined) return undefined
  const setting = value.slice(name.length + 1).toLowerCase()
  if (setting === 'true' || setting === 'on' || setting === 'yes') return true
  if (setting === 'false' || setting === 'off' || setting === 'no') return false
  return undefined
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
