import { createDialect, type Dialect } from '../core/dialect.ts'
import { isColumnReference } from '../expressions/column.ts'
import type {
  AnyExpression,
  AnySchemaExpression,
} from '../expressions/types.ts'
import {
  isUnsafeSchemaSql,
  renderSchemaExpression,
} from '../schema/expressions.ts'
import type { ColumnStorage, PortableStorageType } from '../schema/column.ts'
import type { Schema, SchemaTableEntry } from '../schema/registry.ts'
import {
  isValidSchemaObjectName,
  type SchemaMetadataDiagnostic,
} from '../schema/metadata.ts'
import {
  validateConstraintDialect,
  type SourceConstraint,
} from '../schema/constraints.ts'
import { validateIndexDialect, type SourceIndex } from '../schema/indexes.ts'
import type { AnyTable, TableDefinitions } from '../schema/table.ts'
import { toSnapshotJsonValue } from './canonical.ts'
import {
  createSchemaSnapshot,
  tryCreateSchemaSnapshot,
  type SchemaSnapshotOptions,
} from './serialize.ts'
import {
  schemaSnapshotDialectVersion,
  type SchemaSnapshot,
  type SchemaSnapshotAdapter,
  type SnapshotCreateResult,
  type SnapshotDiagnostic,
  type SnapshotDialect,
  type SnapshotExpression,
  type SnapshotStorage,
  type SnapshotStorageContext,
  type SnapshotExpressionContext,
  type SnapshotExtensionContext,
  type SnapshotValidationContext,
  type SnapshotJsonValue,
} from './types.ts'
import type { SchemaDialectExtension } from '../schema/metadata.ts'

/** SQLite's v1 snapshot extension identity. */
export const sqliteSnapshotDialect: SnapshotDialect = Object.freeze({
  name: 'sqlite',
  version: schemaSnapshotDialectVersion,
})

/** SQLite's five declared-type affinity categories. */
export type SqliteStorageAffinity =
  | 'blob'
  | 'integer'
  | 'numeric'
  | 'real'
  | 'text'

class SqliteSnapshotDialectError extends TypeError {
  readonly code = 'dialect-mismatch' as const
}

const sqliteStorageTypes: Readonly<Record<PortableStorageType, string>> =
  Object.freeze({
    integer: 'INTEGER',
    numeric: 'NUMERIC',
    text: 'TEXT',
    boolean: 'INTEGER',
    date: 'TEXT',
    timestamp: 'TEXT',
    uuid: 'TEXT',
    json: 'TEXT',
    bigint: 'INTEGER',
    binary: 'BLOB',
  })

/**
 * Resolve SQLite's declared-type affinity without changing the declaration.
 * SQLite applies these ordered substring rules at table creation time; the
 * returned affinity is useful metadata, not a replacement for the exact type.
 */
export function sqliteStorageAffinity(
  declaration: string
): SqliteStorageAffinity {
  const upper = declaration.toUpperCase()
  if (upper.includes('INT')) return 'integer'
  if (
    upper.includes('CHAR') ||
    upper.includes('CLOB') ||
    upper.includes('TEXT')
  )
    return 'text'
  if (upper.includes('BLOB') || upper.trim().length === 0) return 'blob'
  if (
    upper.includes('REAL') ||
    upper.includes('FLOA') ||
    upper.includes('DOUB')
  )
    return 'real'
  return 'numeric'
}

/** SQLite's deterministic schema-expression dialect. */
const sqliteSchemaExpressionDialect: Dialect = createDialect({
  name: sqliteSnapshotDialect.name,
  placeholder: () => '?',
  renderSchemaLiteral(value) {
    if (value === null) return 'NULL'
    if (typeof value === 'boolean') return value ? '1' : '0'
    if (typeof value === 'string') return `'${value.replaceAll("'", "''")}'`
    if (typeof value === 'bigint') return String(value)
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        throw new TypeError('SQLite schema literals require finite numbers')
      }
      return Object.is(value, -0) ? '0' : String(value)
    }
    throw new TypeError(
      `Unsupported SQLite schema literal type: ${value === undefined ? 'undefined' : typeof value}`
    )
  },
})

/**
 * Adapter-owned hooks for SQLite storage affinity, literals, expressions, and
 * extensions. Common traversal and canonical ordering remain shared with the
 * other snapshot adapters.
 */
export const sqliteSnapshotAdapter: SchemaSnapshotAdapter = Object.freeze({
  dialect: sqliteSnapshotDialect,
  validate: validateSqliteSchema,
  encodeStorage(
    storage: ColumnStorage,
    context: SnapshotStorageContext
  ): SnapshotStorage {
    return encodeSqliteStorage(storage, context.dialect)
  },
  encodeExpression(
    expression: AnyExpression,
    context: SnapshotExpressionContext
  ): SnapshotExpression {
    return encodeSqliteExpression(expression, context.mode)
  },
  encodeDialectExtension(
    extension: SchemaDialectExtension,
    _context: SnapshotExtensionContext
  ) {
    return encodeSqliteExtension(extension)
  },
})

/** Create a canonical SQLite schema snapshot. */
export function createSqliteSchemaSnapshot<TSchema extends Schema<any>>(
  schema: TSchema,
  options: SqliteSnapshotOptions = {}
): SchemaSnapshot {
  return createSchemaSnapshot(schema, {
    ...options,
    adapter: sqliteSnapshotAdapter,
  })
}

/** Return SQLite capability diagnostics without throwing. */
export function tryCreateSqliteSchemaSnapshot<TSchema extends Schema<any>>(
  schema: TSchema,
  options: SqliteSnapshotOptions = {}
): SnapshotCreateResult {
  return tryCreateSchemaSnapshot(schema, {
    ...options,
    adapter: sqliteSnapshotAdapter,
  })
}

/** Options accepted by the SQLite snapshot convenience functions. */
export type SqliteSnapshotOptions = Omit<
  SchemaSnapshotOptions,
  'adapter' | 'dialect'
>

function encodeSqliteStorage(
  storage: ColumnStorage,
  dialect: SnapshotDialect
): SnapshotStorage {
  if (storage.kind === 'native') {
    if (storage.dialect !== dialect.name) {
      throw new SqliteSnapshotDialectError(
        `SQLite storage cannot encode a native declaration owned by "${storage.dialect}"`
      )
    }
    if (storage.type.trim().length === 0) {
      throw new TypeError('SQLite native storage declarations cannot be empty')
    }
    return {
      kind: 'native',
      dialect: dialect.name,
      type: storage.type,
      affinity: sqliteStorageAffinity(storage.type),
    }
  }

  const type = sqliteStorageTypes[storage.type]
  if (type === undefined) {
    throw new TypeError(
      `Unsupported portable storage type for SQLite: ${String(storage.type)}`
    )
  }
  return {
    kind: 'native',
    dialect: dialect.name,
    type,
    affinity: sqliteStorageAffinity(type),
  }
}

function encodeSqliteExpression(
  expression: AnyExpression,
  mode: 'default' | 'generated' | 'check' | 'index'
): SnapshotExpression {
  if (
    isUnsafeSchemaSql(expression) &&
    expression.schemaSqlDialect !== sqliteSnapshotDialect.name
  ) {
    throw new SqliteSnapshotDialectError(
      `Schema SQL is tagged for "${expression.schemaSqlDialect}" but the SQLite snapshot dialect is "${sqliteSnapshotDialect.name}"`
    )
  }

  const rendered = renderSchemaExpression(expression as AnySchemaExpression, {
    mode,
    dialect: sqliteSchemaExpressionDialect,
  })
  if (rendered.parameters.length !== 0) {
    throw new TypeError('SQLite schema expressions must be parameter-free')
  }

  return {
    kind: 'expression',
    expressionKind: expression.expressionKind,
    sql: rendered.text,
    ...(isUnsafeSchemaSql(expression)
      ? { dialect: sqliteSnapshotDialect.name }
      : {}),
  }
}

function encodeSqliteExtension(extension: { readonly dialect: string }): {
  readonly dialect: string
  readonly version: number
  readonly data: SnapshotJsonValue
} {
  if (extension.dialect !== sqliteSnapshotDialect.name) {
    throw new TypeError(
      `SQLite snapshot extensions require dialect "${sqliteSnapshotDialect.name}"`
    )
  }

  const data = Object.fromEntries(
    Object.entries(extension)
      .filter(([key]) => key !== 'dialect')
      .sort(([left], [right]) => left.localeCompare(right))
  )
  return {
    dialect: sqliteSnapshotDialect.name,
    version: schemaSnapshotDialectVersion,
    data: sortSnapshotJson(toSnapshotJsonValue(data)),
  }
}

function sortSnapshotJson(value: SnapshotJsonValue): SnapshotJsonValue {
  if (Array.isArray(value)) return value.map(sortSnapshotJson)
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortSnapshotJson(child)])
  )
}

function validateSqliteSchema(
  schema: Schema<any>,
  context: SnapshotValidationContext
): readonly SnapshotDiagnostic[] {
  const diagnostics: SnapshotDiagnostic[] = []
  const tableEntries = Object.entries(schema.registry).sort(([left], [right]) =>
    compareIds(left, right)
  )
  const relationNames = new Map<string, readonly (string | number)[]>()

  if (schema.namespace !== undefined) {
    validateSqliteName(
      schema.namespace,
      ['namespace'],
      'SQLite namespace',
      diagnostics
    )
  }

  for (const [id, entry] of tableEntries) {
    const tablePath = ['tables', id] as const
    validateSqliteName(
      entry.physicalName,
      [...tablePath, 'physicalName'],
      'SQLite table',
      diagnostics
    )
    addRelationName(
      relationNames,
      entry.physicalName,
      [...tablePath, 'physicalName'],
      'table',
      diagnostics
    )
  }

  for (const [id, entry] of tableEntries) {
    validateSqliteTable(id, entry, context, relationNames, diagnostics)
  }

  return Object.freeze(diagnostics)
}

function validateSqliteTable(
  tableId: string,
  entry: SchemaTableEntry,
  context: SnapshotValidationContext,
  relationNames: Map<string, readonly (string | number)[]>,
  diagnostics: SnapshotDiagnostic[]
): void {
  const table = entry.table as AnyTable
  const tablePath = ['tables', tableId] as const
  const definitions = table.definitions as TableDefinitions
  const metadata = table as AnyTable & {
    readonly constraints: Readonly<Record<string, SourceConstraint>>
    readonly indexes: Readonly<
      Record<string, SourceIndex & { readonly physicalName?: string }>
    >
  }

  for (const [columnId, definition] of Object.entries(definitions).sort(
    ([left], [right]) => compareIds(left, right)
  )) {
    validateSqliteName(
      table.sqlNames[columnId] ?? columnId,
      [...tablePath, 'columns', columnId, 'physicalName'],
      'SQLite column',
      diagnostics
    )
    if (definition.onUpdate !== undefined) {
      diagnostics.push({
        code: 'unsupported-dialect-option',
        message: 'MySQL ON UPDATE expressions are not supported by SQLite',
        path: [...tablePath, 'columns', columnId, 'onUpdate'],
      })
    }

    const storage = definition.storage

    const identity = definition.identity
    if (identity !== undefined) {
      const identityPath = [...tablePath, 'columns', columnId, 'identity']
      const extension = identity.dialect
      if (
        extension !== undefined &&
        extension.dialect === 'sqlite' &&
        extension.autoIncrement !== undefined &&
        typeof extension.autoIncrement !== 'boolean'
      ) {
        diagnostics.push({
          code: 'unsupported-dialect-option',
          message: 'SQLite identity autoIncrement must be boolean',
          path: [...identityPath, 'dialect', 'autoIncrement'],
        })
      }

      const primary = primaryKeyForColumn(metadata.constraints, columnId)
      const declaration = sqliteDeclaration(storage)
      const affinity =
        declaration === undefined
          ? undefined
          : sqliteStorageAffinity(declaration)
      if (affinity !== 'integer') {
        diagnostics.push({
          code: 'unsupported-dialect-option',
          message:
            'SQLite identity columns must use INTEGER affinity so they can be rowid aliases',
          path: [...identityPath, 'generation'],
        })
      }
      if (primary === undefined || primary.length !== 1) {
        diagnostics.push({
          code: 'unsupported-dialect-option',
          message:
            'SQLite identity columns must be the sole column of a PRIMARY KEY constraint',
          path: [...identityPath, 'generation'],
        })
      }
      if (
        extension?.dialect === 'sqlite' &&
        extension.autoIncrement === true &&
        declaration?.trim().toUpperCase() !== 'INTEGER'
      ) {
        diagnostics.push({
          code: 'unsupported-dialect-option',
          message:
            'SQLite AUTOINCREMENT requires an exact INTEGER PRIMARY KEY declaration',
          path: [...identityPath, 'dialect', 'autoIncrement'],
        })
      }
    }

    const generated = definition.generatedColumn
    if (
      generated?.kind === 'expression' &&
      primaryKeyForColumn(metadata.constraints, columnId) !== undefined
    ) {
      diagnostics.push({
        code: 'unsupported-dialect-option',
        message: 'SQLite generated columns cannot be part of a PRIMARY KEY',
        path: [...tablePath, 'columns', columnId, 'generatedColumn'],
      })
    }
  }

  const constraintNames = new Map<string, readonly (string | number)[]>()
  const constraints = Object.entries(metadata.constraints) as Array<
    [string, SourceConstraint]
  >
  for (const [constraintId, constraint] of constraints.sort(([left], [right]) =>
    compareIds(left, right)
  )) {
    const constraintPath = [...tablePath, 'constraints', constraintId] as const
    const physicalName = constraint.physicalName ?? constraintId
    validateSqliteName(
      physicalName,
      [...constraintPath, 'physicalName'],
      'SQLite constraint',
      diagnostics
    )
    addScopedName(
      constraintNames,
      physicalName,
      [...constraintPath, 'physicalName'],
      'constraint',
      diagnostics
    )
    appendMetadataDiagnostics(
      diagnostics,
      validateConstraintDialect(
        constraint,
        context.dialect.name,
        constraintPath
      )
    )

    if (
      (constraint.kind === 'primary-key' ||
        constraint.kind === 'unique' ||
        constraint.kind === 'unique-constraint' ||
        constraint.kind === 'check') &&
      (constraint.deferrable === true || constraint.initially !== undefined)
    ) {
      diagnostics.push({
        code: 'unsupported-dialect-option',
        message:
          'SQLite only supports DEFERRABLE timing on foreign-key constraints',
        path: [
          ...constraintPath,
          constraint.deferrable ? 'deferrable' : 'initially',
        ],
      })
    }
    if (
      constraint.kind === 'foreign-key' &&
      constraint.match !== undefined &&
      constraint.match !== 'simple'
    ) {
      diagnostics.push({
        code: 'unsupported-dialect-option',
        message: 'SQLite supports MATCH SIMPLE foreign keys only',
        path: [...constraintPath, 'match'],
      })
    }
    if (
      constraint.kind === 'unique-constraint' &&
      constraint.nulls === 'not-distinct'
    ) {
      diagnostics.push({
        code: 'unsupported-dialect-option',
        message:
          'SQLite UNIQUE constraints always use distinct NULL semantics in v1',
        path: [...constraintPath, 'nulls'],
      })
    }
    if (
      constraint.dialect?.dialect === 'sqlite' &&
      'onConflict' in constraint.dialect &&
      constraint.dialect.onConflict !== undefined &&
      !['rollback', 'abort', 'fail', 'ignore', 'replace'].includes(
        String(constraint.dialect.onConflict)
      )
    ) {
      diagnostics.push({
        code: 'unsupported-dialect-option',
        message: 'SQLite constraint onConflict has an unsupported value',
        path: [...constraintPath, 'dialect', 'onConflict'],
      })
    }
  }

  const indexes = Object.entries(metadata.indexes) as Array<
    [string, SourceIndex & { readonly physicalName?: string }]
  >
  for (const [indexId, index] of indexes.sort(([left], [right]) =>
    compareIds(left, right)
  )) {
    const indexPath = [...tablePath, 'indexes', indexId] as const
    const physicalName = index.physicalName ?? indexId
    validateSqliteName(
      physicalName,
      [...indexPath, 'physicalName'],
      'SQLite index',
      diagnostics
    )
    addRelationName(
      relationNames,
      physicalName,
      [...indexPath, 'physicalName'],
      'index',
      diagnostics
    )
    appendMetadataDiagnostics(
      diagnostics,
      validateIndexDialect(index, context.dialect.name, indexPath)
    )
    if (
      index.dialect?.dialect === 'sqlite' &&
      'auto' in index.dialect &&
      index.dialect.auto !== undefined &&
      typeof index.dialect.auto !== 'boolean'
    ) {
      diagnostics.push({
        code: 'unsupported-dialect-option',
        message: 'SQLite index auto must be boolean',
        path: [...indexPath, 'dialect', 'auto'],
      })
    }
  }
}

function sqliteDeclaration(
  storage: ColumnStorage | undefined
): string | undefined {
  if (storage === undefined) return undefined
  if (storage.kind === 'native') return storage.type
  return sqliteStorageTypes[storage.type]
}

function primaryKeyForColumn(
  constraints: Readonly<Record<string, SourceConstraint>>,
  columnId: string
): readonly unknown[] | undefined {
  for (const constraint of Object.values(constraints)) {
    if (constraint.kind !== 'primary-key') continue
    if (
      constraint.columns.some(
        column => isColumnReference(column) && column.fieldName === columnId
      )
    ) {
      return constraint.columns
    }
  }
  return undefined
}

function validateSqliteName(
  name: string,
  path: readonly (string | number)[],
  kind: string,
  diagnostics: SnapshotDiagnostic[]
): void {
  if (!isValidSchemaObjectName(name) || name.length === 0) {
    diagnostics.push({
      code: 'invalid-schema',
      message: `${kind} name "${name}" is not a valid unqualified identifier`,
      path,
    })
  }
}

function addRelationName(
  names: Map<string, readonly (string | number)[]>,
  name: string,
  path: readonly (string | number)[],
  kind: string,
  diagnostics: SnapshotDiagnostic[]
): void {
  addScopedName(names, name, path, kind, diagnostics)
}

function addScopedName(
  names: Map<string, readonly (string | number)[]>,
  name: string,
  path: readonly (string | number)[],
  kind: string,
  diagnostics: SnapshotDiagnostic[]
): void {
  const previousPath = names.get(name)
  if (previousPath !== undefined) {
    diagnostics.push({
      code: 'invalid-schema',
      message: `SQLite ${kind} name "${name}" collides with another table or index`,
      path,
      relatedPaths: [previousPath],
    })
    return
  }
  names.set(name, path)
}

function appendMetadataDiagnostics(
  diagnostics: SnapshotDiagnostic[],
  issues: readonly SchemaMetadataDiagnostic[]
): void {
  for (const issue of issues) {
    if (issue.code === 'dialect-mismatch') continue
    diagnostics.push({
      code:
        issue.code === 'unsupported-dialect-option'
          ? 'unsupported-dialect-option'
          : 'invalid-schema',
      message: issue.message,
      path: issue.path,
      ...(issue.relatedPaths === undefined
        ? {}
        : { relatedPaths: issue.relatedPaths }),
    })
  }
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
