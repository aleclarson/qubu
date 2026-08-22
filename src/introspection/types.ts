import type { IntrospectionDiagnostic } from './diagnostics.ts'
import type {
  CatalogIdentityHints,
  CatalogIdentityPolicy,
  CatalogIdentitySource,
} from './identity.ts'
import type { SchemaSnapshot } from '../snapshot/types.ts'

/** SQL engines supported by the common catalog contract. */
export type CatalogDialect = 'postgresql' | 'sqlite' | 'mysql'

/** A decoded row returned by a user-owned catalog connection. */
export type CatalogQueryRow = Readonly<Record<string, unknown>>

/** Physical objects that can receive stable logical IDs. */
export type CatalogEntityKind =
  | 'namespace'
  | 'table'
  | 'column'
  | 'constraint'
  | 'index'
  | 'view'
  | 'materialized-view'
  | 'sequence'
  | 'enum'
  | 'domain'
  | 'collation'
  | 'trigger'
  | 'routine'
  | 'partition'
  | 'policy'
  | 'extension'
  | 'comment'
  | 'ownership'
  | 'opaque-object'
  | 'deferred-object'

/** A scalar value retained as catalog data rather than executable SQL. */
export type CatalogScalar = null | boolean | string | number | bigint

/** Plain catalog data used for dialect extensions and unknown fields. */
export type CatalogData =
  | CatalogScalar
  | readonly CatalogData[]
  | { readonly [key: string]: CatalogData }

/** A current-run catalog key. It is never a persisted logical identity. */
export interface CatalogCatalogReference {
  readonly relation: string
  readonly key: string
  readonly value: string | number
}

/**
 * A physical object reference with an optional current-run catalog key.
 * PostgreSQL OIDs and similar values belong in `catalog`, not in logical IDs.
 */
export interface CatalogReference {
  readonly kind: CatalogEntityKind
  readonly namespace?: string
  readonly table?: string
  readonly name: string
  readonly catalog?: CatalogCatalogReference
}

/** Where an opaque catalog SQL expression came from. */
export type CatalogProvenanceKind = 'catalog' | 'decompiler' | 'create-sql'

/** Source location retained with catalog-derived SQL text. */
export interface CatalogProvenance {
  readonly kind: CatalogProvenanceKind
  readonly dialect: CatalogDialect
  readonly reference?: CatalogReference
  readonly path?: readonly (string | number)[]
}

/**
 * Opaque SQL text recovered from catalog metadata. It has no evaluator or
 * Qubu expression implementation and must not be executed by introspection.
 */
export interface CatalogSqlExpression {
  readonly kind: 'sql'
  readonly dialect: CatalogDialect
  readonly text: string
  readonly provenance: CatalogProvenance
}

/** A literal catalog fact with optional source provenance. */
export interface CatalogLiteralFact {
  readonly kind: 'literal'
  readonly value: CatalogScalar
  readonly provenance?: CatalogProvenance
}

/** A catalog fact whose value remains opaque dialect SQL. */
export interface CatalogExpressionFact {
  readonly kind: 'expression'
  readonly expression: CatalogSqlExpression
}

/** Tagged data used by defaults, identity options, and dialect metadata. */
export type CatalogValueFact = CatalogLiteralFact | CatalogExpressionFact

/** An unmodeled field retained for later adapter and mapper support. */
export interface CatalogUnknownField {
  readonly name: string
  readonly value: CatalogData | CatalogSqlExpression
  readonly provenance?: CatalogProvenance
}

/** A reference to an object in the normalized catalog. */
export interface CatalogObjectReference {
  readonly kind: Exclude<CatalogEntityKind, 'namespace'>
  readonly id: string
}

/** A comment observed for a physical catalog object. */
export interface CatalogComment {
  readonly kind: 'comment'
  readonly id: string
  readonly object: CatalogObjectReference
  readonly text: string
  readonly reference?: CatalogReference
  readonly provenance?: CatalogProvenance
  readonly dialect?: CatalogDialectExtension
  readonly unknownFields?: readonly CatalogUnknownField[]
}

/** Ownership metadata observed for a physical catalog object. */
export interface CatalogOwnership {
  readonly kind: 'ownership'
  readonly id: string
  readonly object: CatalogObjectReference
  readonly owner: string
  readonly reference?: CatalogReference
  readonly provenance?: CatalogProvenance
  readonly dialect?: CatalogDialectExtension
  readonly unknownFields?: readonly CatalogUnknownField[]
}

/** Optional metadata shared by complete normalized catalog objects. */
export interface CatalogObjectMetadata {
  readonly provenance?: CatalogProvenance
  readonly comment?: CatalogComment
  readonly ownership?: CatalogOwnership
}

/** Common identity and physical-name fields for complete catalog objects. */
export interface CatalogObjectBase extends CatalogObjectMetadata {
  readonly kind: Exclude<CatalogEntityKind, 'namespace'>
  readonly id: string
  readonly identitySource: CatalogIdentitySource
  readonly physicalName: string
  readonly reference?: CatalogReference
  readonly dialect?: CatalogDialectExtension
  readonly unknownFields?: readonly CatalogUnknownField[]
}

/** Portable classification retained beside an exact native declaration. */
export type CatalogPortableStorageType =
  | 'integer'
  | 'numeric'
  | 'text'
  | 'boolean'
  | 'date'
  | 'timestamp'
  | 'uuid'
  | 'json'
  | 'bigint'
  | 'binary'

/** Confidence for a portable classification, never a replacement for native type text. */
export type CatalogClassificationConfidence = 'exact' | 'inferred' | 'unknown'

/** Exact native storage plus an optional portable classification. */
export interface CatalogStorageType {
  readonly nativeType: string
  readonly portable?: {
    readonly type: CatalogPortableStorageType
    readonly confidence: CatalogClassificationConfidence
  }
}

/** A generated-column expression and its recovered storage mode. */
export interface CatalogGeneratedColumn {
  readonly kind: 'generated'
  readonly expression: CatalogSqlExpression
  readonly mode: 'stored' | 'virtual' | 'unknown'
}

/** Identity behavior kept separate from defaults and generated expressions. */
export interface CatalogIdentity {
  readonly kind: 'identity'
  readonly generation: 'always' | 'by-default'
  readonly options: Readonly<Record<string, CatalogValueFact>>
  readonly dialect?: CatalogDialectExtension
}

/** Version parts parsed from a server's raw version string. */
export interface CatalogVersion {
  readonly major: number
  readonly minor?: number
  readonly patch?: number
  readonly suffix?: string
}

/** Calculated feature and visibility facts reported by a catalog adapter. */
export interface CatalogCapabilities {
  readonly generatedColumns: boolean
  readonly identityMetadata: boolean
  readonly checkConstraints: boolean
  readonly checkConstraintEnforcement: 'enforced' | 'metadata-only' | 'unknown'
  readonly expressionDecompilation: boolean
  readonly indexExpressions: boolean
  readonly indexPredicates: boolean
  readonly indexIncludedColumns: boolean
  readonly namespaces: boolean
  readonly visibility: 'complete' | 'limited' | 'unknown'
  readonly [capability: string]: boolean | string
}

/** Server product, raw version text, parsed version, and adapter capabilities. */
export interface CatalogServerInfo {
  readonly product: string
  readonly rawVersion: string
  readonly parsedVersion?: CatalogVersion
  readonly capabilities: CatalogCapabilities
}

/** The one physical namespace selected for a catalog run. */
export interface CatalogNamespace {
  readonly kind: 'postgres-schema' | 'sqlite-database' | 'mysql-database'
  readonly name: string
  readonly reference?: CatalogReference
  readonly provenance?: CatalogProvenance
  readonly comment?: CatalogComment
  readonly ownership?: CatalogOwnership
  readonly dialect?: CatalogDialectExtension
  readonly unknownFields?: readonly CatalogUnknownField[]
}

/** A logical reference used for normalized cross-object relationships. */
export interface CatalogEntityReference {
  readonly kind: Exclude<CatalogEntityKind, 'namespace' | 'deferred-object'>
  readonly id: string
  readonly tableId?: string
}

/** A primary key constraint in the normalized catalog. */
export interface CatalogPrimaryKeyConstraint extends CatalogObjectMetadata {
  readonly kind: 'primary-key'
  readonly id: string
  readonly identitySource: CatalogIdentitySource
  readonly physicalName?: string
  readonly columns: readonly string[]
  readonly backingIndex?: CatalogEntityReference
  readonly deferrable?: boolean
  readonly initially?: 'immediate' | 'deferred'
  readonly validated?: boolean
  readonly reference?: CatalogReference
  readonly dialect?: CatalogDialectExtension
  readonly unknownFields?: readonly CatalogUnknownField[]
}

/** A unique constraint, including nullable uniqueness semantics. */
export interface CatalogUniqueConstraint extends CatalogObjectMetadata {
  readonly kind: 'unique'
  readonly id: string
  readonly identitySource: CatalogIdentitySource
  readonly physicalName?: string
  readonly columns: readonly string[]
  readonly nulls: 'distinct' | 'not-distinct'
  readonly backingIndex?: CatalogEntityReference
  readonly deferrable?: boolean
  readonly initially?: 'immediate' | 'deferred'
  readonly validated?: boolean
  readonly reference?: CatalogReference
  readonly dialect?: CatalogDialectExtension
  readonly unknownFields?: readonly CatalogUnknownField[]
}

/** Ordered target columns and table IDs for a normalized foreign key. */
export interface CatalogForeignKeyTarget {
  readonly table: string
  readonly columns: readonly string[]
}

/** A foreign key with ordered columns and referential actions. */
export interface CatalogForeignKeyConstraint extends CatalogObjectMetadata {
  readonly kind: 'foreign-key'
  readonly id: string
  readonly identitySource: CatalogIdentitySource
  readonly physicalName?: string
  readonly columns: readonly string[]
  readonly target: CatalogForeignKeyTarget
  readonly onUpdate?:
    | 'no-action'
    | 'restrict'
    | 'cascade'
    | 'set-null'
    | 'set-default'
  readonly onDelete?:
    | 'no-action'
    | 'restrict'
    | 'cascade'
    | 'set-null'
    | 'set-default'
  readonly match?: 'simple' | 'full' | 'partial'
  readonly deferrable?: boolean
  readonly initially?: 'immediate' | 'deferred'
  readonly validated?: boolean
  readonly reference?: CatalogReference
  readonly dialect?: CatalogDialectExtension
  readonly unknownFields?: readonly CatalogUnknownField[]
}

/** A check constraint whose expression remains tagged catalog SQL. */
export interface CatalogCheckConstraint extends CatalogObjectMetadata {
  readonly kind: 'check'
  readonly id: string
  readonly identitySource: CatalogIdentitySource
  readonly physicalName?: string
  readonly expression: CatalogSqlExpression
  readonly deferrable?: boolean
  readonly initially?: 'immediate' | 'deferred'
  readonly validated?: boolean
  readonly reference?: CatalogReference
  readonly dialect?: CatalogDialectExtension
  readonly unknownFields?: readonly CatalogUnknownField[]
}

/** Every constraint represented by the normalized catalog contract. */
export type CatalogConstraint =
  | CatalogPrimaryKeyConstraint
  | CatalogUniqueConstraint
  | CatalogForeignKeyConstraint
  | CatalogCheckConstraint

/** One ordered column or expression term in a normalized index. */
export type CatalogIndexTerm =
  | {
      readonly kind: 'column'
      readonly column: string
      readonly position: number
      readonly direction?: 'ASC' | 'DESC'
      readonly nulls?: 'FIRST' | 'LAST'
      readonly prefixLength?: CatalogValueFact
      readonly operatorClass?: string
    }
  | {
      readonly kind: 'expression'
      readonly expression: CatalogSqlExpression
      readonly position: number
      readonly direction?: 'ASC' | 'DESC'
      readonly nulls?: 'FIRST' | 'LAST'
      readonly operatorClass?: string
    }

/** A normalized index with ordered terms and backing relationships. */
export interface CatalogIndex extends CatalogObjectMetadata {
  readonly kind: 'index'
  readonly id: string
  readonly identitySource: CatalogIdentitySource
  readonly physicalName?: string
  readonly unique: boolean
  readonly terms: readonly CatalogIndexTerm[]
  readonly predicate?: CatalogSqlExpression
  readonly includedColumns?: readonly string[]
  readonly backingConstraint?: CatalogEntityReference
  readonly method?: string
  readonly reference?: CatalogReference
  readonly dialect?: CatalogDialectExtension
  readonly unknownFields?: readonly CatalogUnknownField[]
}

/** A normalized table containing only ordinary included table metadata. */
export interface CatalogTable extends CatalogObjectMetadata {
  readonly kind: 'table'
  readonly id: string
  readonly identitySource: CatalogIdentitySource
  readonly physicalName: string
  readonly ordinalPosition?: number
  readonly reference?: CatalogReference
  readonly columns: readonly CatalogColumn[]
  readonly constraints: readonly CatalogConstraint[]
  readonly indexes: readonly CatalogIndex[]
  readonly dialect?: CatalogDialectExtension
  readonly unknownFields?: readonly CatalogUnknownField[]
}

/** A normalized visible column within an ordinary table. */
export interface CatalogColumn extends CatalogObjectMetadata {
  readonly kind: 'column'
  readonly id: string
  readonly identitySource: CatalogIdentitySource
  readonly physicalName: string
  readonly ordinalPosition: number
  readonly nullable: boolean
  readonly storage: CatalogStorageType
  readonly default?: CatalogValueFact
  readonly generated?: CatalogGeneratedColumn
  readonly identity?: CatalogIdentity
  readonly onUpdate?: CatalogSqlExpression
  readonly reference?: CatalogReference
  readonly dialect?: CatalogDialectExtension
  readonly unknownFields?: readonly CatalogUnknownField[]
}

/** Object categories intentionally retained outside Snapshot v1 tables. */
export type CatalogDeferredObjectKind =
  | 'view'
  | 'materialized-view'
  | 'sequence'
  | 'enum'
  | 'domain'
  | 'collation'
  | 'routine'
  | 'trigger'
  | 'policy'
  | 'extension'
  | 'partition'
  | 'virtual-table'
  | 'shadow-table'
  | 'temporary-object'
  | 'foreign-table'
  | 'other'

/** A deferred or unmodeled object retained for diagnostics and future support. */
export interface CatalogDeferredObject extends CatalogObjectMetadata {
  readonly kind: 'deferred-object'
  readonly objectKind: CatalogDeferredObjectKind
  /** Optional in the legacy reader contract; complete readers should set it. */
  readonly id?: string
  readonly identitySource?: CatalogIdentitySource
  readonly physicalName: string
  readonly reference?: CatalogReference
  readonly dialect?: CatalogDialectExtension
  readonly unknownFields?: readonly CatalogUnknownField[]
}

/** A versioned dialect-owned catalog payload. */
export interface CatalogDialectExtension {
  readonly dialect: CatalogDialect
  readonly version: number
  readonly data: CatalogData
}

/** A view or materialized view definition and its exposed columns. */
export interface CatalogView extends CatalogObjectBase {
  readonly kind: 'view' | 'materialized-view'
  readonly columns: readonly CatalogColumn[]
  readonly definition: CatalogSqlExpression
  readonly dependencies?: readonly CatalogObjectReference[]
  readonly checkOption?: 'none' | 'local' | 'cascaded'
  readonly securityBarrier?: boolean
  readonly securityInvoker?: boolean
}

/** Sequence metadata, including options needed to describe an identity. */
export interface CatalogSequence extends CatalogObjectBase {
  readonly kind: 'sequence'
  readonly storage?: CatalogStorageType
  readonly start?: CatalogValueFact
  readonly increment?: CatalogValueFact
  readonly minimum?: CatalogValueFact
  readonly maximum?: CatalogValueFact
  readonly cache?: CatalogValueFact
  readonly cycle?: boolean
  readonly ownedBy?: CatalogObjectReference
  readonly identity?: CatalogIdentity
}

/** One ordered enum label retained exactly as returned by the database. */
export interface CatalogEnumValue {
  readonly value: string
  readonly ordinalPosition: number
  readonly provenance?: CatalogProvenance
}

/** A database enum type with stable label ordering. */
export interface CatalogEnum extends CatalogObjectBase {
  readonly kind: 'enum'
  readonly values: readonly CatalogEnumValue[]
}

/** A domain type layered over a native storage declaration. */
export interface CatalogDomain extends CatalogObjectBase {
  readonly kind: 'domain'
  readonly storage: CatalogStorageType
  readonly nullable?: boolean
  readonly default?: CatalogValueFact
  readonly constraints?: readonly CatalogCheckConstraint[]
}

/** Collation properties that affect comparison and ordering semantics. */
export interface CatalogCollation extends CatalogObjectBase {
  readonly kind: 'collation'
  readonly provider?: string
  readonly locale?: string
  readonly deterministic?: boolean
  readonly version?: string
}

/** A trigger attached to a table or view, retaining its body as opaque SQL. */
export interface CatalogTrigger extends CatalogObjectBase {
  readonly kind: 'trigger'
  readonly table: CatalogObjectReference
  readonly timing: 'before' | 'after' | 'instead-of' | 'unknown'
  readonly events: readonly ('insert' | 'update' | 'delete' | 'truncate')[]
  readonly orientation?: 'row' | 'statement'
  readonly condition?: CatalogSqlExpression
  readonly body: CatalogSqlExpression
  readonly enabled?: boolean
}

/** A routine parameter as observed in a function or procedure signature. */
export interface CatalogRoutineParameter {
  readonly name?: string
  readonly mode?: 'in' | 'out' | 'inout' | 'variadic' | 'table'
  readonly storage: CatalogStorageType
  readonly default?: CatalogValueFact
  readonly ordinalPosition: number
  readonly provenance?: CatalogProvenance
}

/** A function, procedure, aggregate, or other routine declaration. */
export interface CatalogRoutine extends CatalogObjectBase {
  readonly kind: 'routine'
  readonly routineKind:
    | 'function'
    | 'procedure'
    | 'aggregate'
    | 'window'
    | 'unknown'
  readonly parameters: readonly CatalogRoutineParameter[]
  readonly returnType?: CatalogStorageType
  readonly language?: string
  readonly body?: CatalogSqlExpression
  readonly volatility?: 'immutable' | 'stable' | 'volatile' | 'unknown'
  readonly parallel?: 'safe' | 'restricted' | 'unsafe' | 'unknown'
  readonly security?: 'invoker' | 'definer' | 'unknown'
  readonly dependencies?: readonly CatalogObjectReference[]
}

/** A partition child and its normalized bound expression. */
export interface CatalogPartition extends CatalogObjectBase {
  readonly kind: 'partition'
  readonly parent: CatalogObjectReference
  readonly strategy: 'range' | 'list' | 'hash' | 'reference' | 'unknown'
  readonly keyColumns?: readonly string[]
  readonly bound?: CatalogSqlExpression
  readonly default?: boolean
}

/** A row-level security policy attached to a table. */
export interface CatalogPolicy extends CatalogObjectBase {
  readonly kind: 'policy'
  readonly table: CatalogObjectReference
  readonly command:
    | 'all'
    | 'select'
    | 'insert'
    | 'update'
    | 'delete'
    | 'unknown'
  readonly roles?: readonly string[]
  readonly permissive?: boolean
  readonly using?: CatalogSqlExpression
  readonly check?: CatalogSqlExpression
}

/** An engine extension object and its typed, versioned payload. */
export interface CatalogExtensionObject extends CatalogObjectBase {
  readonly kind: 'extension'
  readonly extensionName: string
  readonly extensionVersion?: string
  readonly schema?: string
  readonly data: CatalogData
  readonly configuration?: CatalogData
}

/** An observed object whose family is not yet modeled by a first-party type. */
export interface CatalogOpaqueObject extends CatalogObjectBase {
  readonly kind: 'opaque-object'
  readonly objectKind: string
  readonly data: CatalogData
  readonly sql?: CatalogSqlExpression
}

/** Naming alias for adapters that call retained objects "unknown" records. */
export type CatalogUnknownObject = CatalogOpaqueObject

/** Every complete object family retained by the normalized catalog. */
export type CatalogCompleteObject =
  | CatalogTable
  | CatalogView
  | CatalogSequence
  | CatalogEnum
  | CatalogDomain
  | CatalogCollation
  | CatalogTrigger
  | CatalogRoutine
  | CatalogPartition
  | CatalogPolicy
  | CatalogExtensionObject
  | CatalogOpaqueObject
  | CatalogDeferredObject
  | CatalogComment
  | CatalogOwnership

/** Short alias for the complete normalized object union. */
export type CatalogObject = CatalogCompleteObject

/** The complete normalized catalog shape used by the v2 snapshot mapper. */
export interface CompleteIntrospectionCatalog {
  readonly dialect: CatalogDialect
  readonly server: CatalogServerInfo
  readonly capabilities: CatalogCapabilities
  readonly namespace: CatalogNamespace
  readonly tables: readonly CatalogTable[]
  readonly views: readonly CatalogView[]
  readonly sequences: readonly CatalogSequence[]
  readonly enums: readonly CatalogEnum[]
  readonly domains: readonly CatalogDomain[]
  readonly collations: readonly CatalogCollation[]
  readonly triggers: readonly CatalogTrigger[]
  readonly routines: readonly CatalogRoutine[]
  readonly partitions: readonly CatalogPartition[]
  readonly policies: readonly CatalogPolicy[]
  readonly extensionObjects: readonly CatalogExtensionObject[]
  readonly deferredObjects: readonly CatalogDeferredObject[]
  readonly opaqueObjects: readonly CatalogOpaqueObject[]
  readonly comments: readonly CatalogComment[]
  readonly ownership: readonly CatalogOwnership[]
  readonly diagnostics: readonly IntrospectionDiagnostic[]
}

/** The complete normalized catalog for one selected physical namespace. */
export interface IntrospectionCatalog {
  readonly dialect: CatalogDialect
  readonly server: CatalogServerInfo
  readonly namespace: CatalogNamespace
  readonly tables: readonly CatalogTable[]
  /** Complete object families are optional until a dialect reader populates them. */
  readonly views?: readonly CatalogView[]
  readonly sequences?: readonly CatalogSequence[]
  readonly enums?: readonly CatalogEnum[]
  readonly domains?: readonly CatalogDomain[]
  readonly collations?: readonly CatalogCollation[]
  readonly triggers?: readonly CatalogTrigger[]
  readonly routines?: readonly CatalogRoutine[]
  readonly partitions?: readonly CatalogPartition[]
  readonly policies?: readonly CatalogPolicy[]
  readonly extensionObjects?: readonly CatalogExtensionObject[]
  readonly deferredObjects: readonly CatalogDeferredObject[]
  readonly opaqueObjects?: readonly CatalogOpaqueObject[]
  readonly comments?: readonly CatalogComment[]
  readonly ownership?: readonly CatalogOwnership[]
  readonly capabilities?: CatalogCapabilities
  readonly diagnostics: readonly IntrospectionDiagnostic[]
}

/** Strictness of the optional normalized-catalog-to-snapshot step. */
export type IntrospectionMode = 'strict' | 'lossy'

/** Inputs shared by dialect adapters and the later snapshot mapper. */
export interface IntrospectionOptions {
  /** PostgreSQL schema, MySQL database, or SQLite database name. */
  readonly namespace: string
  readonly previousSnapshot?: SchemaSnapshot
  readonly identityHints?: CatalogIdentityHints
  readonly identityPolicy?: CatalogIdentityPolicy
  /** Strict is the default. Lossy output must be requested explicitly. */
  readonly mode?: IntrospectionMode
  readonly signal?: AbortSignal
}

/** A successful introspection result with a canonical snapshot. */
export interface IntrospectionSuccess {
  readonly ok: true
  readonly catalog: IntrospectionCatalog
  readonly snapshot: SchemaSnapshot
  readonly diagnostics: readonly IntrospectionDiagnostic[]
  readonly lossy: boolean
}

/** A failed introspection result, optionally retaining a partial catalog. */
export interface IntrospectionFailure {
  readonly ok: false
  readonly catalog?: IntrospectionCatalog
  readonly diagnostics: readonly IntrospectionDiagnostic[]
  readonly lossy: false
}

/** Result returned by a non-throwing introspection operation. */
export type IntrospectionResult = IntrospectionSuccess | IntrospectionFailure

/** Function shape for a later dialect-specific catalog reader. */
export type CatalogIntrospector = (
  connection: import('./connection.ts').CatalogConnection,
  options: IntrospectionOptions
) => Promise<IntrospectionResult>
