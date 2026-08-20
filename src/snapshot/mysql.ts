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
import { mysqlJson } from '../dialects/json.ts'
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
import type { MysqlIdentityExtension } from '../schema/column-behavior.ts'

/** MySQL's v1 snapshot extension identity. */
export const mysqlSnapshotDialect: SnapshotDialect = Object.freeze({
  name: 'mysql',
  version: schemaSnapshotDialectVersion,
})

class MysqlSnapshotDialectError extends TypeError {
  readonly code = 'dialect-mismatch' as const
}

const mysqlStorageTypes: Readonly<Record<PortableStorageType, string>> =
  Object.freeze({
    integer: 'INT',
    numeric: 'DECIMAL',
    text: 'TEXT',
    boolean: 'BOOLEAN',
    date: 'DATE',
    timestamp: 'DATETIME',
    uuid: 'CHAR(36)',
    json: 'JSON',
    bigint: 'BIGINT',
    binary: 'VARBINARY',
  })

/** MySQL's deterministic schema-expression dialect. */
const mysqlSchemaExpressionDialect: Dialect = createDialect({
  name: mysqlSnapshotDialect.name,
  quoteIdentifier: identifier => `\`${identifier.replaceAll('`', '``')}\``,
  placeholder: () => '?',
  json: mysqlJson,
  castTypes: {
    integer: 'SIGNED',
    text: 'CHAR',
    boolean: 'UNSIGNED',
    timestamp: 'DATETIME',
    uuid: 'CHAR(36)',
    bigint: 'SIGNED',
    binary: 'BINARY',
  },
  renderSchemaLiteral(value) {
    if (value === null) return 'NULL'
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
    if (typeof value === 'string') return `'${value.replaceAll("'", "''")}'`
    if (typeof value === 'bigint') return String(value)
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        throw new TypeError('MySQL schema literals require finite numbers')
      }
      return Object.is(value, -0) ? '0' : String(value)
    }
    throw new TypeError(
      `Unsupported MySQL schema literal type: ${value === undefined ? 'undefined' : typeof value}`
    )
  },
})

/**
 * Adapter-owned hooks for MySQL storage, literals, expressions, and
 * extensions. Traversal and canonical ordering remain in `qubu/snapshot`.
 */
export const mysqlSnapshotAdapter: SchemaSnapshotAdapter = Object.freeze({
  dialect: mysqlSnapshotDialect,
  validate: validateMysqlSchema,
  encodeStorage(
    storage: ColumnStorage,
    context: SnapshotStorageContext
  ): SnapshotStorage {
    return encodeMysqlStorage(storage, context.dialect)
  },
  encodeExpression(
    expression: AnyExpression,
    context: SnapshotExpressionContext
  ): SnapshotExpression {
    return encodeMysqlExpression(expression, context.mode)
  },
  encodeDialectExtension(
    extension: SchemaDialectExtension,
    _context: SnapshotExtensionContext
  ) {
    return encodeMysqlExtension(extension)
  },
})

/** Create a canonical MySQL schema snapshot. */
export function createMysqlSchemaSnapshot<TSchema extends Schema<any>>(
  schema: TSchema,
  options: MysqlSnapshotOptions = {}
): SchemaSnapshot {
  return createSchemaSnapshot(schema, {
    ...options,
    adapter: mysqlSnapshotAdapter,
  })
}

/** Return MySQL capability diagnostics without throwing. */
export function tryCreateMysqlSchemaSnapshot<TSchema extends Schema<any>>(
  schema: TSchema,
  options: MysqlSnapshotOptions = {}
): SnapshotCreateResult {
  return tryCreateSchemaSnapshot(schema, {
    ...options,
    adapter: mysqlSnapshotAdapter,
  })
}

/** Options accepted by the MySQL snapshot convenience functions. */
export type MysqlSnapshotOptions = Omit<
  SchemaSnapshotOptions,
  'adapter' | 'dialect'
>

function encodeMysqlStorage(
  storage: ColumnStorage,
  dialect: SnapshotDialect
): SnapshotStorage {
  if (storage.kind === 'native') {
    if (storage.dialect !== dialect.name) {
      throw new MysqlSnapshotDialectError(
        `MySQL storage cannot encode a native declaration owned by "${storage.dialect}"`
      )
    }
    if (storage.type.trim().length === 0) {
      throw new TypeError('MySQL native storage declarations cannot be empty')
    }
    return {
      kind: 'native',
      dialect: dialect.name,
      type: storage.type,
    }
  }

  const type = mysqlStorageTypes[storage.type]
  if (type === undefined) {
    throw new TypeError(
      `Unsupported portable storage type for MySQL: ${String(storage.type)}`
    )
  }
  return { kind: 'native', dialect: dialect.name, type }
}

function encodeMysqlExpression(
  expression: AnyExpression,
  mode: 'default' | 'generated' | 'check' | 'index'
): SnapshotExpression {
  if (
    isUnsafeSchemaSql(expression) &&
    expression.schemaSqlDialect !== mysqlSnapshotDialect.name
  ) {
    throw new MysqlSnapshotDialectError(
      `Schema SQL is tagged for "${expression.schemaSqlDialect}" but the MySQL snapshot dialect is "${mysqlSnapshotDialect.name}"`
    )
  }

  const rendered = renderSchemaExpression(expression as AnySchemaExpression, {
    mode,
    dialect: mysqlSchemaExpressionDialect,
  })
  if (rendered.parameters.length !== 0) {
    throw new TypeError('MySQL schema expressions must be parameter-free')
  }

  return {
    kind: 'expression',
    expressionKind: expression.expressionKind,
    sql: rendered.text,
    ...(isUnsafeSchemaSql(expression)
      ? { dialect: mysqlSnapshotDialect.name }
      : {}),
  }
}

function encodeMysqlExtension(extension: { readonly dialect: string }): {
  readonly dialect: string
  readonly version: number
  readonly data: SnapshotJsonValue
} {
  if (extension.dialect !== mysqlSnapshotDialect.name) {
    throw new MysqlSnapshotDialectError(
      `MySQL snapshot extensions require dialect "${mysqlSnapshotDialect.name}"`
    )
  }

  const data = Object.fromEntries(
    Object.entries(extension)
      .filter(([key]) => key !== 'dialect')
      .sort(([left], [right]) => left.localeCompare(right))
  )
  return {
    dialect: mysqlSnapshotDialect.name,
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

function validateMysqlSchema(
  schema: Schema<any>,
  context: SnapshotValidationContext
): readonly SnapshotDiagnostic[] {
  const diagnostics: SnapshotDiagnostic[] = []
  const tableEntries = Object.entries(schema.registry).sort(([left], [right]) =>
    compareIds(left, right)
  )
  const relationNames = new Map<string, readonly (string | number)[]>()

  if (schema.namespace !== undefined) {
    validateMysqlName(
      schema.namespace,
      ['namespace'],
      'MySQL database/schema',
      diagnostics
    )
  }

  for (const [id, entry] of tableEntries) {
    const tablePath = ['tables', id] as const
    validateMysqlName(
      entry.physicalName,
      [...tablePath, 'physicalName'],
      'MySQL table',
      diagnostics
    )
    addScopedName(
      relationNames,
      entry.physicalName,
      [...tablePath, 'physicalName'],
      'table',
      diagnostics
    )
  }

  for (const [id, entry] of tableEntries) {
    validateMysqlTable(id, entry, context, diagnostics)
  }

  return Object.freeze(diagnostics)
}

function validateMysqlTable(
  tableId: string,
  entry: SchemaTableEntry,
  context: SnapshotValidationContext,
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
    const columnPath = [...tablePath, 'columns', columnId] as const
    validateMysqlName(
      table.sqlNames[columnId] ?? columnId,
      [...columnPath, 'physicalName'],
      'MySQL column',
      diagnostics
    )

    if (definition.onUpdate !== undefined && definition.generatedColumn) {
      diagnostics.push({
        code: 'unsupported-dialect-option',
        message: 'MySQL generated columns cannot also declare ON UPDATE',
        path: [...columnPath, 'onUpdate'],
      })
    }

    const identity = definition.identity
    const extension = identity?.dialect
    const autoIncrement =
      extension?.dialect === mysqlSnapshotDialect.name
        ? (extension as MysqlIdentityExtension).autoIncrement
        : undefined
    if (
      extension?.dialect === mysqlSnapshotDialect.name &&
      autoIncrement !== undefined &&
      typeof autoIncrement !== 'boolean'
    ) {
      diagnostics.push({
        code: 'unsupported-dialect-option',
        message: 'MySQL identity autoIncrement must be boolean',
        path: [...columnPath, 'identity', 'dialect', 'autoIncrement'],
      })
    }
    if (autoIncrement === true) {
      validateMysqlAutoIncrement(
        columnId,
        definition,
        metadata,
        columnPath,
        diagnostics
      )
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
    validateMysqlName(
      physicalName,
      [...constraintPath, 'physicalName'],
      'MySQL constraint',
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
      constraint.kind === 'foreign-key' &&
      (constraint.match === 'full' || constraint.match === 'partial')
    ) {
      diagnostics.push({
        code: 'unsupported-dialect-option',
        message: 'MySQL v1 snapshots support MATCH SIMPLE foreign keys only',
        path: [...constraintPath, 'match'],
      })
    }
    if (
      constraint.kind === 'foreign-key' &&
      (constraint.onUpdate === 'set-default' ||
        constraint.onDelete === 'set-default')
    ) {
      diagnostics.push({
        code: 'unsupported-dialect-option',
        message: 'MySQL does not support SET DEFAULT foreign-key actions',
        path: [
          ...constraintPath,
          constraint.onUpdate === 'set-default' ? 'onUpdate' : 'onDelete',
        ],
      })
    }
    if (
      constraint.kind === 'unique-constraint' &&
      constraint.nulls === 'not-distinct'
    ) {
      diagnostics.push({
        code: 'unsupported-dialect-option',
        message:
          'MySQL ordinary UNIQUE constraints use distinct NULL semantics in v1',
        path: [...constraintPath, 'nulls'],
      })
    }
    if (
      constraint.dialect?.dialect === mysqlSnapshotDialect.name &&
      'enforced' in constraint.dialect &&
      constraint.dialect.enforced !== undefined &&
      typeof constraint.dialect.enforced !== 'boolean'
    ) {
      diagnostics.push({
        code: 'unsupported-dialect-option',
        message: 'MySQL constraint enforced must be boolean',
        path: [...constraintPath, 'dialect', 'enforced'],
      })
    }
  }

  const indexes = Object.entries(metadata.indexes) as Array<
    [string, SourceIndex & { readonly physicalName?: string }]
  >
  // MySQL index names are scoped to their table.
  const tableIndexNames = new Map<string, readonly (string | number)[]>()
  for (const [indexId, index] of indexes.sort(([left], [right]) =>
    compareIds(left, right)
  )) {
    const indexPath = [...tablePath, 'indexes', indexId] as const
    const physicalName = index.physicalName ?? indexId
    validateMysqlName(
      physicalName,
      [...indexPath, 'physicalName'],
      'MySQL index',
      diagnostics
    )
    addScopedName(
      tableIndexNames,
      physicalName,
      [...indexPath, 'physicalName'],
      'index',
      diagnostics
    )
    appendMetadataDiagnostics(
      diagnostics,
      validateIndexDialect(index, context.dialect.name, indexPath)
    )
    if (index.predicate !== undefined) {
      diagnostics.push({
        code: 'unsupported-dialect-option',
        message: 'MySQL does not support partial-index predicates',
        path: [...indexPath, 'predicate'],
      })
    }
    for (const [termIndex, term] of index.terms.entries()) {
      if (isOrderTerm(term) && term.nulls !== undefined) {
        diagnostics.push({
          code: 'unsupported-dialect-option',
          message: 'MySQL index terms do not support NULLS FIRST/LAST syntax',
          path: [...indexPath, 'terms', termIndex, 'nulls'],
        })
      }
    }
    const extension = index.dialect
    if (extension?.dialect === mysqlSnapshotDialect.name) {
      const mysqlExtension = extension as {
        readonly algorithm?: unknown
        readonly lock?: unknown
        readonly using?: unknown
        readonly parser?: unknown
      }
      if (
        mysqlExtension.algorithm !== undefined &&
        !['default', 'inplace', 'copy'].includes(
          String(mysqlExtension.algorithm)
        )
      ) {
        diagnostics.push({
          code: 'unsupported-dialect-option',
          message: 'MySQL index algorithm is invalid',
          path: [...indexPath, 'dialect', 'algorithm'],
        })
      }
      if (
        mysqlExtension.lock !== undefined &&
        !['default', 'none', 'shared', 'exclusive'].includes(
          String(mysqlExtension.lock)
        )
      ) {
        diagnostics.push({
          code: 'unsupported-dialect-option',
          message: 'MySQL index lock mode is invalid',
          path: [...indexPath, 'dialect', 'lock'],
        })
      }
      if (
        mysqlExtension.using !== undefined &&
        !['btree', 'hash', 'rtree'].includes(String(mysqlExtension.using))
      ) {
        diagnostics.push({
          code: 'unsupported-dialect-option',
          message: 'MySQL index access method is invalid',
          path: [...indexPath, 'dialect', 'using'],
        })
      }
      if (
        mysqlExtension.parser !== undefined &&
        (typeof mysqlExtension.parser !== 'string' ||
          mysqlExtension.parser.trim().length === 0)
      ) {
        diagnostics.push({
          code: 'unsupported-dialect-option',
          message: 'MySQL index parser must be a non-empty string',
          path: [...indexPath, 'dialect', 'parser'],
        })
      }
    }
  }
}

function validateMysqlAutoIncrement(
  columnId: string,
  definition: TableDefinitions[string],
  metadata: AnyTable & {
    readonly constraints: Readonly<Record<string, SourceConstraint>>
    readonly indexes: Readonly<Record<string, SourceIndex>>
  },
  columnPath: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[]
): void {
  if (definition.nullable) {
    diagnostics.push({
      code: 'unsupported-dialect-option',
      message: 'MySQL AUTO_INCREMENT columns must be non-nullable',
      path: [...columnPath, 'nullable'],
    })
  }
  if (definition.generatedColumn !== undefined) {
    diagnostics.push({
      code: 'unsupported-dialect-option',
      message: 'MySQL AUTO_INCREMENT columns cannot be generated columns',
      path: [...columnPath, 'generatedColumn'],
    })
  }
  const declaration = mysqlDeclaration(definition.storage)
  if (declaration === undefined || !isMysqlIntegerDeclaration(declaration)) {
    diagnostics.push({
      code: 'unsupported-dialect-option',
      message:
        'MySQL AUTO_INCREMENT requires an integer-family physical storage declaration',
      path: [...columnPath, 'storage'],
    })
  }
  if (!hasMysqlAutoIncrementKey(columnId, metadata)) {
    diagnostics.push({
      code: 'unsupported-dialect-option',
      message:
        'MySQL AUTO_INCREMENT columns must be the first column of a primary, unique, or ordinary index key',
      path: [...columnPath, 'identity', 'dialect', 'autoIncrement'],
    })
  }
}

function mysqlDeclaration(
  storage: ColumnStorage | undefined
): string | undefined {
  if (storage === undefined) return undefined
  return storage.kind === 'native'
    ? storage.type
    : mysqlStorageTypes[storage.type]
}

function isMysqlIntegerDeclaration(declaration: string): boolean {
  const base = declaration.trim().toUpperCase().split(/\s+/u)[0] ?? ''
  return /^(?:TINYINT|SMALLINT|MEDIUMINT|INT|INTEGER|BIGINT)(?:\(\d+\))?$/u.test(
    base
  )
}

function hasMysqlAutoIncrementKey(
  columnId: string,
  metadata: {
    readonly constraints: Readonly<Record<string, SourceConstraint>>
    readonly indexes: Readonly<Record<string, SourceIndex>>
  }
): boolean {
  for (const constraint of Object.values(metadata.constraints)) {
    if (
      (constraint.kind === 'primary-key' ||
        constraint.kind === 'unique' ||
        constraint.kind === 'unique-constraint') &&
      isColumnReference(constraint.columns[0]) &&
      constraint.columns[0].fieldName === columnId
    ) {
      return true
    }
  }
  for (const index of Object.values(metadata.indexes)) {
    const first = index.terms[0]
    const expression = isOrderTerm(first) ? first.expression : first
    if (isColumnReference(expression) && expression.fieldName === columnId) {
      return true
    }
  }
  return false
}

function validateMysqlName(
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
  if ([...name].length > 64) {
    diagnostics.push({
      code: 'unsupported-dialect-option',
      message: `${kind} name exceeds MySQL's 64-character identifier limit`,
      path,
    })
  }
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
      message: `MySQL ${kind} name "${name}" collides with another ${kind}`,
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

function isOrderTerm(value: unknown): value is {
  readonly orderKind: 'term'
  readonly expression: AnyExpression
  readonly nulls?: 'FIRST' | 'LAST'
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'orderKind' in value &&
    (value as { readonly orderKind?: unknown }).orderKind === 'term' &&
    'expression' in value
  )
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
