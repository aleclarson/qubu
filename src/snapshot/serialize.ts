import { isColumnReference } from '../expressions/column.ts'
import type {
  AnyExpression,
  AnySchemaExpression,
} from '../expressions/types.ts'
import type { OrderTerm } from '../query/clauses/order-by.ts'
import type { AnyTable, TableDefinitions } from '../schema/table.ts'
import type {
  ColumnDefault,
  GeneratedColumnDescriptor,
  IdentityDescriptor,
} from '../schema/column-behavior.ts'
import type { ColumnStorage } from '../schema/column.ts'
import type {
  ForeignKeyConstraint,
  SourceConstraint,
  ForeignKeyTarget,
} from '../schema/constraints.ts'
import { defaultSchemaNamingPolicy, type Schema } from '../schema/registry.ts'
import type { SchemaDialect } from '../schema/dialect.ts'
import { createSchemaDialect } from '../schema/dialect.ts'
import type { SchemaDialectExtension } from '../schema/metadata.ts'
import { generatedSchemaObjectName } from '../schema/metadata.ts'
import {
  isUnsafeSchemaSql,
  renderSchemaExpression,
} from '../schema/expressions.ts'
import { standardDialect } from '../dialects/standard.ts'
import { assertSchemaSnapshot, SnapshotValidationError } from './decode.ts'
import {
  encodeCanonicalSnapshot,
  schemaSnapshotDigest,
  toSnapshotJsonValue,
} from './canonical.ts'
import {
  neutralSnapshotDialect,
  schemaSnapshotDialectVersion,
  schemaSnapshotFormat,
  schemaSnapshotNamingPolicyVersion,
  schemaSnapshotVersion,
  type SchemaSnapshot,
  type SchemaSnapshotAdapter,
  type SnapshotCheckConstraint,
  type SnapshotColumn,
  type SnapshotConstraint,
  type SnapshotCreateResult,
  type SnapshotDefault,
  type SnapshotDialectExtension,
  type SnapshotExpression,
  type SnapshotForeignKey,
  type SnapshotGeneratedColumn,
  type SnapshotIdentity,
  type SnapshotIndex,
  type SnapshotIndexTerm,
  type SnapshotIndexTermExpression,
  type SnapshotKeyConstraint,
  type SnapshotLiteral,
  type SnapshotTable,
  type SnapshotUniqueConstraint,
} from './types.ts'
import type { SnapshotDiagnostic, SnapshotExpressionContext } from './types.ts'

const neutralSchemaDialect = createSchemaDialect(
  Object.freeze({
    ...standardDialect(),
    name: neutralSnapshotDialect.name,
  }),
  { version: schemaSnapshotDialectVersion }
)

/** Error raised when a live Qubu schema cannot be represented as a snapshot. */
export class SnapshotSerializationError extends SnapshotValidationError {
  readonly name = 'SnapshotSerializationError'
}

/** Options for the neutral traversal and a future dialect adapter. */
export interface SchemaSnapshotOptions {
  readonly adapter?: SchemaSnapshotAdapter
  readonly dialect?: SchemaDialect
  /** Explicit hook overrides retained for custom tooling integrations. */
  readonly expressionEncoder?: SchemaDialect['schema']['encodeExpression']
  readonly storageEncoder?: SchemaDialect['schema']['encodeStorage']
  readonly extensionEncoder?: SchemaDialect['schema']['encodeDialectExtension']
  readonly namingPolicy?: {
    readonly name: string
    readonly version?: number
  }
}

/** Create a neutral or adapter-owned immutable snapshot from a live schema. */
export function createSchemaSnapshot<TSchema extends Schema<any>>(
  schema: TSchema,
  options: SchemaSnapshotOptions = {}
): SchemaSnapshot {
  const result = tryCreateSchemaSnapshot(schema, options)
  if (!result.ok) throw new SnapshotSerializationError(result.diagnostics)
  return result.value
}

/** Non-throwing form of {@link createSchemaSnapshot}. */
export function tryCreateSchemaSnapshot<TSchema extends Schema<any>>(
  schema: TSchema,
  options: SchemaSnapshotOptions = {}
): SnapshotCreateResult {
  const diagnostics: SnapshotDiagnostic[] = []
  if (!isSchemaRoot(schema)) {
    return {
      ok: false,
      diagnostics: [
        {
          code: 'invalid-schema',
          message: 'Snapshot input must be a Qubu schema registry',
          path: [],
        },
      ],
    }
  }

  if (
    options.adapter !== undefined &&
    options.dialect !== undefined &&
    (options.adapter.dialect.name !== options.dialect.name ||
      options.adapter.dialect.schema.version !== options.dialect.schema.version)
  ) {
    return {
      ok: false,
      diagnostics: [
        {
          code: 'dialect-mismatch',
          message: 'Snapshot adapter and explicit dialect must agree',
          path: ['dialect'],
          relatedPaths: [['adapter', 'dialect']],
        },
      ],
    }
  }

  const adapter = options.adapter
  const dialect = options.dialect ?? adapter?.dialect ?? neutralSchemaDialect
  const namingPolicy =
    options.namingPolicy ??
    dialect.schema.namingPolicy ??
    Object.freeze({
      name:
        schema.namingPolicy.tableName === defaultSchemaNamingPolicy.tableName
          ? 'snake-case'
          : 'custom',
      version: schema.namingPolicy.version ?? schemaSnapshotNamingPolicyVersion,
    })
  const tableEntries = Object.entries(schema.registry)
  const tableIds = new Map<object, string>()
  const tablesById = new Map<string, AnyTable>()

  const validate = adapter?.dialect.schema.validate ?? dialect.schema.validate
  if (validate !== undefined) {
    try {
      diagnostics.push(
        ...validate(schema, {
          path: [],
          dialect,
        })
      )
    } catch (error) {
      diagnostics.push({
        code: 'invalid-schema',
        message: error instanceof Error ? error.message : String(error),
        path: [],
      })
    }
  }

  for (const [id, entry] of tableEntries) {
    tableIds.set(entry.table, id)
    tablesById.set(id, entry.table)
  }

  const tables = tableEntries
    .map(([id, entry]) =>
      serializeTable(
        id,
        entry.table,
        entry.physicalName,
        tableIds,
        tablesById,
        dialect,
        options,
        diagnostics
      )
    )
    .filter((table): table is SnapshotTable => table !== undefined)
    .sort(compareId)

  if (diagnostics.length > 0) {
    return { ok: false, diagnostics: Object.freeze(diagnostics) }
  }

  const rawSnapshot: SchemaSnapshot = {
    format: schemaSnapshotFormat,
    version: schemaSnapshotVersion,
    dialect: Object.freeze({
      name: dialect.name,
      version: dialect.schema.version,
    }),
    namingPolicy: Object.freeze({
      name: namingPolicy.name,
      version: namingPolicy.version ?? schemaSnapshotNamingPolicyVersion,
    }),
    ...(schema.namespace === undefined ? {} : { namespace: schema.namespace }),
    tables,
  }

  try {
    return { ok: true, value: assertSchemaSnapshot(rawSnapshot) }
  } catch (error) {
    if (error instanceof SnapshotValidationError) {
      return { ok: false, diagnostics: error.diagnostics }
    }
    return {
      ok: false,
      diagnostics: [
        {
          code: 'invalid-schema',
          message: error instanceof Error ? error.message : String(error),
          path: [],
        },
      ],
    }
  }
}

/** Encode a valid snapshot using fixed property order and canonical JSON. */
export function encodeSchemaSnapshot(snapshot: SchemaSnapshot): string {
  const canonical = assertSchemaSnapshot(snapshot)
  return encodeCanonicalSnapshot(canonical)
}

/** Alias used by tooling packages that call the operation serialization. */
export const serializeSchema = createSchemaSnapshot

/** Alias for the canonical snapshot encoder. */
export const encodeSnapshot = encodeSchemaSnapshot

/** Alias for the canonical snapshot digest helper. */
export const digestSchemaSnapshot = schemaSnapshotDigest

function serializeTable(
  id: string,
  table: AnyTable,
  physicalName: string,
  tableIds: ReadonlyMap<object, string>,
  tablesById: ReadonlyMap<string, AnyTable>,
  dialect: SchemaDialect,
  options: SchemaSnapshotOptions,
  diagnostics: SnapshotDiagnostic[]
): SnapshotTable | undefined {
  const definitions = table.definitions as TableDefinitions
  const tableMetadata = table as AnyTable & {
    readonly constraints: Readonly<Record<string, SourceConstraint>>
    readonly indexes: Readonly<
      Record<
        string,
        {
          readonly terms: readonly (AnyExpression | OrderTerm<any>)[]
          readonly unique: boolean
          readonly candidateKey: boolean
          readonly predicate: AnyExpression | undefined
          readonly includedColumns?: readonly AnyExpression[]
          readonly physicalName?: string
          readonly dialect?: SchemaDialectExtension
        }
      >
    >
  }
  const columns = Object.entries(definitions)
    .map(([fieldName, definition]) =>
      serializeColumn(
        fieldName,
        definition,
        table.sqlNames[fieldName] ?? fieldName,
        dialect,
        options,
        diagnostics
      )
    )
    .sort(compareId)

  const constraints = Object.entries(tableMetadata.constraints)
    .map(([constraintId, constraint]) =>
      serializeConstraint(
        constraintId,
        constraint as SourceConstraint,
        table,
        tableIds,
        tablesById,
        dialect,
        options,
        diagnostics
      )
    )
    .filter(
      (constraint): constraint is SnapshotConstraint => constraint !== undefined
    )
    .sort(compareId)

  const indexes = Object.entries(tableMetadata.indexes)
    .map(([indexId, indexMetadata]) =>
      serializeIndex(
        indexId,
        indexMetadata,
        table,
        dialect,
        options,
        diagnostics
      )
    )
    .filter((index): index is SnapshotIndex => index !== undefined)
    .sort(compareId)

  return {
    id,
    physicalName,
    columns,
    constraints,
    indexes,
  }
}

function serializeColumn(
  id: string,
  definition: TableDefinitions[string],
  physicalName: string,
  dialect: SchemaDialect,
  options: SchemaSnapshotOptions,
  diagnostics: SnapshotDiagnostic[]
): SnapshotColumn {
  const storage = definition.storage
    ? encodeStorage(
        definition.storage,
        dialect,
        ['tables', id, 'columns', id, 'storage'],
        options,
        diagnostics
      )
    : undefined
  const defaultValue = definition.default
    ? encodeDefault(
        definition.default,
        dialect,
        ['columns', id, 'default'],
        options,
        diagnostics
      )
    : undefined
  const generatedColumn = definition.generatedColumn
    ? encodeGenerated(
        definition.generatedColumn,
        dialect,
        ['columns', id, 'generatedColumn'],
        options,
        diagnostics
      )
    : undefined
  const identity = definition.identity
    ? encodeIdentity(
        definition.identity,
        dialect,
        ['tables', id, 'columns', id, 'identity'],
        options,
        diagnostics
      )
    : undefined
  const onUpdate = definition.onUpdate
    ? encodeExpression(
        definition.onUpdate,
        'default',
        dialect,
        ['columns', id, 'onUpdate'],
        options,
        diagnostics
      )
    : undefined
  return {
    id,
    physicalName,
    nullable: definition.nullable,
    hasDefault: definition.hasDefault,
    generated: definition.generated,
    ...(storage === undefined ? {} : { storage }),
    ...(defaultValue === undefined ? {} : { default: defaultValue }),
    ...(generatedColumn === undefined ? {} : { generatedColumn }),
    ...(identity === undefined ? {} : { identity }),
    ...(onUpdate === undefined ? {} : { onUpdate }),
  }
}

function encodeStorage(
  storage: ColumnStorage,
  dialect: SchemaDialect,
  path: readonly (string | number)[],
  options: SchemaSnapshotOptions,
  diagnostics: SnapshotDiagnostic[]
) {
  if (storage.kind === 'native' && storage.dialect !== dialect.name) {
    diagnostics.push({
      code: 'dialect-mismatch',
      message: `Native storage belongs to "${storage.dialect}" but the snapshot dialect is "${dialect.name}"`,
      path,
    })
    return undefined
  }
  const encoder =
    options.storageEncoder ??
    options.adapter?.dialect.schema.encodeStorage ??
    dialect.schema.encodeStorage
  if (encoder !== undefined) {
    try {
      return encoder(storage, { path, dialect })
    } catch (error) {
      diagnostics.push({
        code: 'invalid-schema',
        message: error instanceof Error ? error.message : String(error),
        path,
      })
      return undefined
    }
  }
  if (storage.kind === 'portable') {
    return { kind: 'portable' as const, type: storage.type }
  }
  return {
    kind: 'native' as const,
    dialect: storage.dialect,
    type: storage.type,
  }
}

function encodeDefault(
  value: ColumnDefault,
  dialect: SchemaDialect,
  path: readonly (string | number)[],
  options: SchemaSnapshotOptions,
  diagnostics: SnapshotDiagnostic[]
): SnapshotDefault | undefined {
  if (value.kind === 'external') return { kind: 'external' }
  if (value.kind === 'literal') {
    return { kind: 'literal', value: value.value as SnapshotLiteral }
  }
  const expression = encodeExpression(
    value.expression,
    'default',
    dialect,
    path,
    options,
    diagnostics
  )
  return expression === undefined
    ? undefined
    : { kind: 'expression', expression }
}

function encodeGenerated(
  value: GeneratedColumnDescriptor,
  dialect: SchemaDialect,
  path: readonly (string | number)[],
  options: SchemaSnapshotOptions,
  diagnostics: SnapshotDiagnostic[]
): SnapshotGeneratedColumn | undefined {
  if (value.kind === 'external') return { kind: 'external' }
  const expression = encodeExpression(
    value.expression,
    'generated',
    dialect,
    path,
    options,
    diagnostics
  )
  return expression === undefined
    ? undefined
    : { kind: 'expression', expression, mode: value.mode }
}

function encodeIdentity(
  value: IdentityDescriptor,
  dialect: SchemaDialect,
  path: readonly (string | number)[],
  options: SchemaSnapshotOptions,
  diagnostics: SnapshotDiagnostic[]
): SnapshotIdentity | undefined {
  const extension = encodeExtension(
    value.dialect,
    dialect,
    [...path, 'dialect'],
    options,
    diagnostics
  )
  return {
    kind: 'identity',
    generation: value.generation,
    ...(extension === undefined ? {} : { dialect: extension }),
  }
}

function serializeConstraint(
  id: string,
  constraint: SourceConstraint,
  table: AnyTable,
  tableIds: ReadonlyMap<object, string>,
  tablesById: ReadonlyMap<string, AnyTable>,
  dialect: SchemaDialect,
  options: SchemaSnapshotOptions,
  diagnostics: SnapshotDiagnostic[]
): SnapshotConstraint | undefined {
  const physicalName = constraint.physicalName ?? generatedSchemaObjectName(id)
  const common = {
    id,
    kind: constraint.kind,
    physicalName,
  }

  if (
    constraint.kind === 'primary-key' ||
    constraint.kind === 'unique' ||
    constraint.kind === 'unique-constraint'
  ) {
    const columns = serializeColumns(
      constraint.columns,
      table,
      ['constraints', id, 'columns'],
      diagnostics
    )
    const extension = encodeExtension(
      constraint.dialect,
      dialect,
      ['constraints', id, 'dialect'],
      options,
      diagnostics
    )
    if (columns === undefined) return undefined
    const timing = serializeTiming(constraint)
    if (constraint.kind === 'unique-constraint') {
      return {
        ...common,
        kind: 'unique-constraint',
        columns,
        nulls: constraint.nulls,
        ...timing,
        ...(extension === undefined ? {} : { dialect: extension }),
      } satisfies SnapshotUniqueConstraint
    }
    return {
      ...common,
      kind: constraint.kind,
      columns,
      ...timing,
      ...(extension === undefined ? {} : { dialect: extension }),
    } satisfies SnapshotKeyConstraint
  }

  if (constraint.kind === 'foreign-key') {
    const columns = serializeColumns(
      constraint.columns,
      table,
      ['constraints', id, 'columns'],
      diagnostics
    )
    const target = resolveForeignKeyTarget(
      constraint,
      tableIds,
      tablesById,
      ['constraints', id, 'target'],
      diagnostics
    )
    const extension = encodeExtension(
      constraint.dialect,
      dialect,
      ['constraints', id, 'dialect'],
      options,
      diagnostics
    )
    if (columns === undefined || target === undefined) return undefined
    return {
      ...common,
      kind: 'foreign-key',
      columns,
      target,
      ...(constraint.onUpdate === undefined
        ? {}
        : { onUpdate: constraint.onUpdate }),
      ...(constraint.onDelete === undefined
        ? {}
        : { onDelete: constraint.onDelete }),
      ...(constraint.match === undefined ? {} : { match: constraint.match }),
      ...serializeTiming(constraint),
      ...(extension === undefined ? {} : { dialect: extension }),
    } satisfies SnapshotForeignKey
  }

  if (constraint.kind === 'check') {
    const expression = encodeExpression(
      constraint.expression,
      'check',
      dialect,
      ['constraints', id, 'expression'],
      options,
      diagnostics
    )
    const extension = encodeExtension(
      constraint.dialect,
      dialect,
      ['constraints', id, 'dialect'],
      options,
      diagnostics
    )
    if (expression === undefined) return undefined
    return {
      ...common,
      kind: 'check',
      expression,
      ...serializeTiming(constraint),
      ...(extension === undefined ? {} : { dialect: extension }),
    } satisfies SnapshotCheckConstraint
  }

  diagnostics.push({
    code: 'invalid-schema',
    message: `Unsupported constraint kind on "${id}"`,
    path: ['constraints', id],
  })
  return undefined
}

function serializeTiming(value: {
  readonly deferrable?: boolean
  readonly initially?: 'immediate' | 'deferred'
}) {
  return {
    ...(value.deferrable === undefined ? {} : { deferrable: value.deferrable }),
    ...(value.initially === undefined ? {} : { initially: value.initially }),
  }
}

function serializeColumns(
  columns: readonly AnyExpression[],
  table: AnyTable,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[]
): readonly string[] | undefined {
  const result: string[] = []
  for (const [index, column] of columns.entries()) {
    if (!isColumnReference(column)) {
      diagnostics.push({
        code: 'invalid-schema',
        message: 'Constraint columns must be column references',
        path: [...path, index],
      })
      continue
    }
    if (!(column.fieldName in table.definitions)) {
      diagnostics.push({
        code: 'unresolved-reference',
        message: `Column "${column.fieldName}" is not declared on table "${table.tableName}"`,
        path: [...path, index],
      })
      continue
    }
    result.push(column.fieldName)
  }
  return result.length === columns.length && result.length > 0
    ? result
    : undefined
}

function resolveForeignKeyTarget(
  constraint: ForeignKeyConstraint,
  tableIds: ReadonlyMap<object, string>,
  tablesById: ReadonlyMap<string, AnyTable>,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[]
): SnapshotForeignKey['target'] | undefined {
  let target: ForeignKeyTarget
  try {
    target = (
      typeof constraint.target === 'function'
        ? constraint.target()
        : constraint.target
    ) as ForeignKeyTarget
  } catch (error) {
    diagnostics.push({
      code: 'unresolved-reference',
      message: `Foreign-key target could not be resolved: ${
        error instanceof Error ? error.message : String(error)
      }`,
      path,
    })
    return undefined
  }

  const targetId = tableIds.get(target.table)
  if (targetId === undefined || !tablesById.has(targetId)) {
    diagnostics.push({
      code: 'unresolved-reference',
      message: 'Foreign-key target table is not registered in the schema',
      path: [...path, 'table'],
    })
    return undefined
  }
  const targetColumns = serializeColumns(
    target.columns,
    target.table as AnyTable,
    [...path, 'columns'],
    diagnostics
  )
  if (targetColumns === undefined) return undefined
  return { table: targetId, columns: targetColumns }
}

function serializeIndex(
  id: string,
  indexMetadata: {
    readonly terms: readonly (AnyExpression | OrderTerm<any>)[]
    readonly unique: boolean
    readonly candidateKey: boolean
    readonly predicate: AnyExpression | undefined
    readonly includedColumns?: readonly AnyExpression[]
    readonly physicalName?: string
    readonly dialect?: SchemaDialectExtension
  },
  table: AnyTable,
  dialect: SchemaDialect,
  options: SchemaSnapshotOptions,
  diagnostics: SnapshotDiagnostic[]
): SnapshotIndex | undefined {
  const terms: SnapshotIndexTerm[] = []
  for (const [termIndex, term] of indexMetadata.terms.entries()) {
    const serialized = serializeIndexTerm(
      term,
      table,
      dialect,
      ['indexes', id, 'terms', termIndex],
      options,
      diagnostics
    )
    if (serialized !== undefined) terms.push(serialized)
  }
  const predicate =
    indexMetadata.predicate === undefined
      ? undefined
      : encodeExpression(
          indexMetadata.predicate,
          'index',
          dialect,
          ['indexes', id, 'predicate'],
          options,
          diagnostics
        )
  const includedColumns =
    indexMetadata.includedColumns === undefined
      ? undefined
      : serializeColumns(
          indexMetadata.includedColumns,
          table,
          ['indexes', id, 'includedColumns'],
          diagnostics
        )
  const extension = encodeExtension(
    indexMetadata.dialect,
    dialect,
    ['indexes', id, 'dialect'],
    options,
    diagnostics
  )
  if (
    terms.length !== indexMetadata.terms.length ||
    (indexMetadata.includedColumns !== undefined &&
      includedColumns === undefined)
  )
    return undefined
  return {
    id,
    kind: 'index',
    physicalName: indexMetadata.physicalName ?? generatedSchemaObjectName(id),
    terms,
    unique: indexMetadata.unique,
    candidateKey: indexMetadata.candidateKey,
    ...(predicate === undefined ? {} : { predicate }),
    ...(includedColumns === undefined ? {} : { includedColumns }),
    ...(extension === undefined ? {} : { dialect: extension }),
  }
}

function serializeIndexTerm(
  term: AnyExpression | OrderTerm<any>,
  table: AnyTable,
  dialect: SchemaDialect,
  path: readonly (string | number)[],
  options: SchemaSnapshotOptions,
  diagnostics: SnapshotDiagnostic[]
): SnapshotIndexTerm | undefined {
  if (isOrderTerm(term)) {
    const expression = serializeIndexTermExpression(
      term.expression,
      table,
      dialect,
      [...path, 'expression'],
      options,
      diagnostics
    )
    return expression === undefined
      ? undefined
      : {
          kind: 'order',
          expression,
          ...(term.direction === undefined
            ? {}
            : { direction: term.direction }),
          ...(term.nulls === undefined ? {} : { nulls: term.nulls }),
        }
  }
  return serializeIndexTermExpression(
    term,
    table,
    dialect,
    path,
    options,
    diagnostics
  )
}

function serializeIndexTermExpression(
  expression: AnyExpression,
  table: AnyTable,
  dialect: SchemaDialect,
  path: readonly (string | number)[],
  options: SchemaSnapshotOptions,
  diagnostics: SnapshotDiagnostic[]
): SnapshotIndexTermExpression | undefined {
  if (isColumnReference(expression)) {
    if (!(expression.fieldName in table.definitions)) {
      diagnostics.push({
        code: 'unresolved-reference',
        message: `Index column "${expression.fieldName}" is not declared on table "${table.tableName}"`,
        path,
      })
      return undefined
    }
    return { kind: 'column', column: expression.fieldName }
  }
  const encoded = encodeExpression(
    expression,
    'index',
    dialect,
    path,
    options,
    diagnostics
  )
  return encoded === undefined
    ? undefined
    : { kind: 'expression', expression: encoded }
}

function encodeExpression(
  expression: AnyExpression,
  mode: SnapshotExpressionContext['mode'],
  dialect: SchemaDialect,
  path: readonly (string | number)[],
  options: SchemaSnapshotOptions,
  diagnostics: SnapshotDiagnostic[]
): SnapshotExpression | undefined {
  const encoder =
    options.expressionEncoder ??
    options.adapter?.dialect.schema.encodeExpression ??
    dialect.schema.encodeExpression
  if (encoder !== undefined) {
    try {
      return encoder(expression, { mode, path, dialect })
    } catch (error) {
      const code =
        error instanceof Error &&
        'code' in error &&
        (error as { readonly code?: unknown }).code === 'dialect-mismatch'
          ? 'dialect-mismatch'
          : 'unsupported-expression'
      diagnostics.push({
        code,
        message: error instanceof Error ? error.message : String(error),
        path,
      })
      return undefined
    }
  }

  // The common format still needs to represent built-in deterministic
  // expressions when no target dialect adapter has been selected. The active
  // schema dialect remains the rendering policy, so identifiers and literals
  // cannot silently drift from query rendering.
  if (isUnsafeSchemaSql(expression)) {
    if (expression.schemaSqlDialect !== dialect.name) {
      diagnostics.push({
        code: 'dialect-mismatch',
        message: `Schema SQL is tagged for "${expression.schemaSqlDialect}" but the snapshot dialect is "${dialect.name}"`,
        path,
      })
      return undefined
    }
    return {
      kind: 'expression',
      expressionKind: expression.expressionKind,
      sql: expression.schemaSql,
      dialect: expression.schemaSqlDialect,
    }
  }
  try {
    const rendered = renderSchemaExpression(expression as AnySchemaExpression, {
      mode,
      dialect,
    })
    return {
      kind: 'expression',
      expressionKind: expression.expressionKind,
      sql: rendered.text,
    }
  } catch (error) {
    diagnostics.push({
      code: 'unsupported-expression',
      message: error instanceof Error ? error.message : String(error),
      path,
    })
    return undefined
  }
}

function encodeExtension(
  extension: SchemaDialectExtension | undefined,
  dialect: SchemaDialect,
  path: readonly (string | number)[],
  options: SchemaSnapshotOptions,
  diagnostics: SnapshotDiagnostic[]
): SnapshotDialectExtension | undefined {
  if (extension === undefined) return undefined
  if (extension.dialect !== dialect.name) {
    diagnostics.push({
      code: 'dialect-mismatch',
      message: `Dialect extension belongs to "${extension.dialect}" but the snapshot dialect is "${dialect.name}"`,
      path,
    })
    return undefined
  }
  const encoder =
    options.extensionEncoder ??
    options.adapter?.dialect.schema.encodeDialectExtension ??
    dialect.schema.encodeDialectExtension
  if (encoder !== undefined) {
    try {
      return encoder(extension, { path, dialect })
    } catch (error) {
      diagnostics.push({
        code: 'dialect-mismatch',
        message: error instanceof Error ? error.message : String(error),
        path,
      })
      return undefined
    }
  }
  const data: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(extension)) {
    if (key !== 'dialect') data[key] = value
  }
  try {
    return {
      dialect: extension.dialect,
      version: dialect.schema.version,
      data: toSnapshotJsonValue(data),
    }
  } catch (error) {
    diagnostics.push({
      code: 'invalid-value',
      message: error instanceof Error ? error.message : String(error),
      path,
    })
    return undefined
  }
}

function isOrderTerm(value: unknown): value is OrderTerm<any> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'orderKind' in value &&
    (value as { readonly orderKind?: unknown }).orderKind === 'term' &&
    'expression' in value
  )
}

function isSchemaRoot(value: unknown): value is Schema<any> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { readonly schemaKind?: unknown }).schemaKind === 'schema' &&
    typeof (value as { readonly registry?: unknown }).registry === 'object' &&
    (value as { readonly registry?: unknown }).registry !== null
  )
}

function compareId(
  left: { readonly id: string },
  right: { readonly id: string }
): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
}
