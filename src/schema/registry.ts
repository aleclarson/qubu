import { snakeCaseIdentifier } from '../core/naming.ts'
import type { AnyTable } from './table.ts'

/** The first naming-policy version used by schema metadata. */
export const schemaNamingPolicyVersion = 1 as const

/** A deterministic policy for names generated from logical schema IDs. */
export interface SchemaNamingPolicy {
  /** Versioned policy identifier stored with schema metadata. */
  readonly version: typeof schemaNamingPolicyVersion
  /** Generate a physical table name from a logical table ID. */
  readonly tableName: (logicalId: string) => string
}

/**
 * The built-in naming policy for schema-generated physical names.
 *
 * Explicit names supplied to `table()` remain unchanged. The policy is used
 * by tooling when it needs a physical name for a logical table ID.
 */
export const defaultSchemaNamingPolicy: SchemaNamingPolicy = Object.freeze({
  version: schemaNamingPolicyVersion,
  tableName: snakeCaseIdentifier,
})

/** A table record accepted by {@link schema}. */
export type SchemaTableRecord = Readonly<Record<string, AnyTable>>

/** A tuple form that can represent duplicate IDs for diagnostic testing. */
type SchemaTableInput = readonly [string, AnyTable]

/** Options that apply to a root schema registry. */
export interface SchemaOptions {
  /** Physical database namespace used by the schema, such as `public`. */
  readonly namespace?: string
  /** Naming policy metadata used by snapshot tooling for generated names. */
  readonly namingPolicy?: SchemaNamingPolicy
}

/** A physical-name record for one stable registry entry. */
export interface SchemaTableEntry<
  TId extends string = string,
  TTable extends AnyTable = AnyTable,
> {
  /** Stable logical ID taken from the schema registry key. */
  readonly id: TId
  /** The query-facing table declaration retained by the registry. */
  readonly table: TTable
  /** Physical SQL name used by the table declaration. */
  readonly physicalName: string
}

export type SchemaTableRegistry<TTables extends SchemaTableRecord> = {
  readonly [K in keyof TTables & string]: SchemaTableEntry<K, TTables[K]>
}

export type SchemaTableNames<TTables extends SchemaTableRecord> = Readonly<{
  [K in keyof TTables & string]: string
}>

/** The root model returned by {@link schema}. */
export interface Schema<TTables extends SchemaTableRecord = SchemaTableRecord> {
  readonly schemaKind: 'schema'
  /** Tables keyed by stable logical ID. */
  readonly tables: Readonly<TTables>
  /** Explicit registry entries with logical and physical identity separated. */
  readonly registry: SchemaTableRegistry<TTables>
  /** Materialized physical names keyed by stable logical ID. */
  readonly tableNames: SchemaTableNames<TTables>
  /** Optional database namespace. */
  readonly namespace: string | undefined
  /** Versioned naming policy used by schema tooling. */
  readonly namingPolicy: SchemaNamingPolicy
}

/** A structured validation finding produced while constructing a schema. */
export interface SchemaDiagnostic {
  readonly code:
    | 'invalid-table-id'
    | 'duplicate-table-id'
    | 'duplicate-physical-name'
    | 'invalid-namespace'
    | 'generated-name-collision'
  readonly message: string
  /** Location of the invalid or conflicting declaration. */
  readonly path: readonly (string | number)[]
  /** Other declaration locations involved in a collision, when applicable. */
  readonly relatedPaths?: readonly (readonly (string | number)[])[]
}

/** Error thrown when a root schema fails registry or naming validation. */
export class SchemaValidationError extends Error {
  readonly name = 'SchemaValidationError'
  readonly diagnostics: readonly SchemaDiagnostic[]
  /** Alias matching validation libraries that call findings "issues". */
  readonly issues: readonly SchemaDiagnostic[]

  constructor(diagnostics: readonly SchemaDiagnostic[]) {
    const frozenDiagnostics = Object.freeze(
      diagnostics.map(diagnostic =>
        Object.freeze({
          ...diagnostic,
          path: Object.freeze([...diagnostic.path]),
          relatedPaths: diagnostic.relatedPaths
            ? Object.freeze(
                diagnostic.relatedPaths.map(path => Object.freeze([...path]))
              )
            : undefined,
        })
      )
    )
    super(frozenDiagnostics.map(diagnostic => diagnostic.message).join('\n'))
    this.diagnostics = frozenDiagnostics
    this.issues = frozenDiagnostics
  }
}

type EntriesToTables<TEntries extends readonly SchemaTableInput[]> = {
  readonly [TEntry in TEntries[number] as TEntry[0]]: Extract<
    TEntries[number],
    readonly [TEntry[0], AnyTable]
  >[1]
}

type SchemaInput = SchemaTableRecord | readonly SchemaTableInput[]

function entriesOf(input: SchemaInput): readonly SchemaTableInput[] {
  if (Array.isArray(input)) return input
  return Object.entries(input)
}

function validLogicalId(id: string): boolean {
  return (
    id.length > 0 && id === id.trim() && !/[.\\/\u0000-\u001f\u007f]/u.test(id)
  )
}

function validNamespace(namespace: string): boolean {
  return (
    namespace.length > 0 &&
    namespace === namespace.trim() &&
    !/[.\\/\u0000-\u001f\u007f"']/u.test(namespace)
  )
}

function validateEntries(
  entries: readonly SchemaTableInput[],
  namespace: string | undefined,
  namingPolicy: SchemaNamingPolicy
): readonly SchemaDiagnostic[] {
  const diagnostics: SchemaDiagnostic[] = []
  const ids = new Map<string, number>()
  const physicalNames = new Map<string, number>()
  const generatedNames = new Map<string, number>()

  for (const [index, [id, table]] of entries.entries()) {
    const path = ['tables', id] as const
    const previousId = ids.get(id)
    if (previousId !== undefined) {
      diagnostics.push({
        code: 'duplicate-table-id',
        message: `Table ID "${id}" is declared more than once`,
        path,
        relatedPaths: [['tables', entries[previousId][0]]],
      })
    } else {
      ids.set(id, index)
    }

    if (!validLogicalId(id)) {
      diagnostics.push({
        code: 'invalid-table-id',
        message: `Table ID "${id}" must be a non-empty logical identifier`,
        path,
      })
    }

    const physicalName = table.tableName || namingPolicy.tableName(id)
    const previousPhysicalName = physicalNames.get(physicalName)
    if (previousPhysicalName !== undefined) {
      diagnostics.push({
        code: 'duplicate-physical-name',
        message: `Tables "${entries[previousPhysicalName][0]}" and "${id}" both use physical name "${physicalName}"`,
        path: [...path, 'physicalName'],
        relatedPaths: [
          ['tables', entries[previousPhysicalName][0], 'physicalName'],
        ],
      })
    } else {
      physicalNames.set(physicalName, index)
    }

    const generatedName = namingPolicy.tableName(id)
    const previousGeneratedName = generatedNames.get(generatedName)
    if (previousGeneratedName !== undefined) {
      diagnostics.push({
        code: 'generated-name-collision',
        message: `Logical table IDs "${entries[previousGeneratedName][0]}" and "${id}" generate the same physical name "${generatedName}"`,
        path: [...path, 'generatedName'],
        relatedPaths: [
          ['tables', entries[previousGeneratedName][0], 'generatedName'],
        ],
      })
    } else {
      generatedNames.set(generatedName, index)
    }
  }

  if (namespace !== undefined && !validNamespace(namespace)) {
    diagnostics.push({
      code: 'invalid-namespace',
      message: `Schema namespace "${namespace}" must be a non-empty identifier without qualification or control characters`,
      path: ['namespace'],
    })
  }

  return Object.freeze(diagnostics)
}

function freezeTableNames(
  entries: readonly SchemaTableInput[],
  namingPolicy: SchemaNamingPolicy
): Readonly<Record<string, string>> {
  return Object.freeze(
    Object.fromEntries(
      entries.map(([id, table]) => [
        id,
        table.tableName || namingPolicy.tableName(id),
      ])
    )
  )
}

function createSchema<TTables extends SchemaTableRecord>(
  entries: readonly SchemaTableInput[],
  tables: TTables,
  options: SchemaOptions = {}
): Schema<TTables> {
  const namingPolicy = options.namingPolicy ?? defaultSchemaNamingPolicy
  const diagnostics = validateEntries(entries, options.namespace, namingPolicy)
  if (diagnostics.length > 0) throw new SchemaValidationError(diagnostics)

  const tableNames = freezeTableNames(entries, namingPolicy)
  const registry = Object.freeze(
    Object.fromEntries(
      entries.map(([id, table]) => [
        id,
        Object.freeze({
          id,
          table,
          physicalName: tableNames[id],
        }),
      ])
    )
  ) as SchemaTableRegistry<TTables>

  return Object.freeze({
    schemaKind: 'schema' as const,
    tables: Object.freeze({ ...tables }),
    registry,
    tableNames: tableNames as SchemaTableNames<TTables>,
    namespace: options.namespace,
    namingPolicy: Object.freeze({ ...namingPolicy }),
  }) as Schema<TTables>
}

/**
 * Create an immutable root registry keyed by stable logical table IDs.
 *
 * The input keys are logical IDs. Each table keeps the physical name already
 * used by query rendering, so registering a table does not change its row
 * inference, source identity, or generated SQL. The optional namespace is
 * metadata for schema tooling and is not added to ordinary query rendering.
 *
 * @throws {@link SchemaValidationError} when IDs, physical names, namespaces,
 * or generated names collide or are invalid.
 */
export function schema<const TTables extends SchemaTableRecord>(
  tables: TTables,
  options?: SchemaOptions
): Schema<TTables>
/**
 * Tuple input is useful for integrations that need duplicate-ID diagnostics
 * before converting declarations into an object record.
 */
export function schema<const TEntries extends readonly SchemaTableInput[]>(
  tables: TEntries,
  options?: SchemaOptions
): Schema<EntriesToTables<TEntries>>
export function schema(
  tables: SchemaInput,
  options?: SchemaOptions
): Schema<SchemaTableRecord> {
  const entries = entriesOf(tables)
  const tableRecord = Object.fromEntries(entries) as SchemaTableRecord
  return createSchema(entries, tableRecord, options)
}

/** Generate a v1 physical name for a logical table ID. */
export function generatedTableName(
  logicalId: string,
  namingPolicy: SchemaNamingPolicy = defaultSchemaNamingPolicy
): string {
  return namingPolicy.tableName(logicalId)
}
