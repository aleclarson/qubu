import { snakeCaseIdentifier } from '../core/naming.ts'

/** Dialect identities with first-party schema metadata adapters. */
export type SchemaDialectName = 'postgresql' | 'sqlite' | 'mysql'

/** A dialect-owned extension attached to serializable schema metadata. */
export interface SchemaDialectExtension<TDialect extends string = string> {
  readonly dialect: TDialect
}

/** An optional physical-name override for a relational schema object. */
export interface SchemaObjectNameOptions {
  /** Physical SQL name; the metadata record key remains the logical ID. */
  readonly physicalName?: string
}

/** Common identity fields materialized on constraints and indexes. */
export interface SchemaObjectIdentity {
  /** Stable logical ID, normally the metadata record key. */
  readonly id?: string
  /** Resolved physical SQL object name. */
  readonly physicalName?: string
}

/** Structured diagnostics produced while resolving relational metadata. */
export interface SchemaMetadataDiagnostic {
  readonly code:
    | 'invalid-physical-name'
    | 'duplicate-physical-name'
    | 'dialect-mismatch'
    | 'unsupported-dialect-option'
  readonly message: string
  readonly path: readonly (string | number)[]
  readonly relatedPaths?: readonly (readonly (string | number)[])[]
  readonly dialect?: string
}

/** Error raised when relational metadata cannot be represented safely. */
export class SchemaMetadataValidationError extends TypeError {
  readonly name = 'SchemaMetadataValidationError'
  readonly diagnostics: readonly SchemaMetadataDiagnostic[]
  readonly issues: readonly SchemaMetadataDiagnostic[]

  constructor(diagnostics: readonly SchemaMetadataDiagnostic[]) {
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

/** Generate the version-one physical name for a relational object ID. */
export function generatedSchemaObjectName(id: string): string {
  return snakeCaseIdentifier(id)
}

/** Deep-freeze plain metadata values without introducing executable nodes. */
export function freezeSchemaMetadata<T>(value: T): T {
  if (Array.isArray(value)) {
    return Object.freeze(value.map(item => freezeSchemaMetadata(item))) as T
  }
  if (typeof value !== 'object' || value === null) return value

  const frozen = Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      freezeSchemaMetadata(nested),
    ])
  )
  return Object.freeze(frozen) as T
}

/** Check the portable identifier subset used for generated metadata names. */
export function isValidSchemaObjectName(name: string): boolean {
  return (
    name.length > 0 &&
    name === name.trim() &&
    !/[.\\/\u0000-\u001f\u007f"']/u.test(name)
  )
}

/**
 * Attach a record key and resolved physical name without changing the
 * enumerable shape of legacy constraint/index values. The properties are
 * still ordinary read-only runtime metadata and are available to snapshot
 * traversals.
 */
export function materializeSchemaObjectIdentity<TValue extends object>(
  value: TValue,
  id: string,
  physicalName?: string
): TValue & SchemaObjectIdentity {
  const materialized = { ...value } as TValue & SchemaObjectIdentity
  Object.defineProperties(materialized, {
    id: {
      configurable: false,
      enumerable: false,
      value: id,
      writable: false,
    },
    physicalName: {
      configurable: false,
      enumerable: false,
      value: physicalName ?? generatedSchemaObjectName(id),
      writable: false,
    },
  })
  return Object.freeze(materialized)
}

type NamedMetadataValue = object & {
  readonly physicalName?: string
}

/**
 * Resolve and validate names for one metadata record. The caller decides
 * whether constraint and index names share a database namespace.
 */
export function materializeSchemaObjectRecord<
  TValue extends NamedMetadataValue,
>(
  record: Readonly<Record<string, TValue>>,
  kind: 'constraint' | 'index'
): Readonly<Record<string, TValue & SchemaObjectIdentity>> {
  const diagnostics: SchemaMetadataDiagnostic[] = []
  const names = new Map<string, string>()
  const result: Record<string, TValue & SchemaObjectIdentity> = {}

  for (const [id, value] of Object.entries(record)) {
    const physicalName = value.physicalName ?? generatedSchemaObjectName(id)
    const path = [kind === 'constraint' ? 'constraints' : 'indexes', id]

    if (!isValidSchemaObjectName(physicalName)) {
      diagnostics.push({
        code: 'invalid-physical-name',
        message: `The ${kind} "${id}" has invalid physical name "${physicalName}"`,
        path: [...path, 'physicalName'],
      })
    }

    const previousId = names.get(physicalName)
    if (previousId !== undefined) {
      diagnostics.push({
        code: 'duplicate-physical-name',
        message: `The ${kind}s "${previousId}" and "${id}" both use physical name "${physicalName}"`,
        path: [...path, 'physicalName'],
        relatedPaths: [
          [
            kind === 'constraint' ? 'constraints' : 'indexes',
            previousId,
            'physicalName',
          ],
        ],
      })
    } else {
      names.set(physicalName, id)
    }

    result[id] = materializeSchemaObjectIdentity(value, id, physicalName)
  }

  if (diagnostics.length > 0) {
    throw new SchemaMetadataValidationError(diagnostics)
  }

  return Object.freeze(result)
}

/** Return a diagnostic when a dialect extension is used by another adapter. */
export function dialectMismatchDiagnostic(
  extension: SchemaDialectExtension,
  dialect: string,
  path: readonly (string | number)[]
): SchemaMetadataDiagnostic | undefined {
  if (extension.dialect === dialect) return undefined
  return {
    code: 'dialect-mismatch',
    message: `Dialect extension belongs to "${extension.dialect}" but the active schema dialect is "${dialect}"`,
    path,
    dialect,
  }
}

/** Throw a structured error for one or more dialect capability findings. */
export function assertSchemaDialectSupport(
  diagnostics: readonly SchemaMetadataDiagnostic[]
): void {
  if (diagnostics.length > 0) {
    throw new SchemaMetadataValidationError(diagnostics)
  }
}
