import type {
  SnapshotDefault,
  SnapshotDialect,
  SnapshotDialectExtension,
  SnapshotExpression,
  SnapshotGeneratedColumn,
  SnapshotJsonValue,
  SnapshotLiteral,
  SnapshotNamingPolicy,
  SnapshotStorage,
} from "./types.ts"
import { schemaSnapshotFormat, schemaSnapshotVersion } from "./types.ts"

/** The canonical schema snapshot envelope tag. */
export const completeSchemaSnapshotFormat = schemaSnapshotFormat

/** The current strict format version for the complete catalog/object model. */
export const completeSchemaSnapshotVersion = schemaSnapshotVersion

/** Descriptive alias for consumers that select a numbered snapshot version. */
export const schemaSnapshotV1Version = completeSchemaSnapshotVersion

/** Explicit format-version aliases for generated tooling and fixtures. */
export const schemaSnapshotCompleteVersion = completeSchemaSnapshotVersion
export const schemaSnapshotVersion1 = completeSchemaSnapshotVersion

/** Object families that may appear in a complete canonical snapshot. */
export type CompleteSnapshotObjectKind =
  | "namespace"
  | "table"
  | "column"
  | "constraint"
  | "index"
  | "view"
  | "materialized-view"
  | "sequence"
  | "enum"
  | "domain"
  | "collation"
  | "trigger"
  | "routine"
  | "partition"
  | "policy"
  | "extension"
  | "comment"
  | "ownership"
  | "deferred-object"
  | "opaque-object"

/** A stable logical object reference used by complete snapshot relations. */
export interface CompleteSnapshotObjectReference {
  readonly kind: Exclude<CompleteSnapshotObjectKind, "namespace">
  readonly id: string
}

/** Source evidence retained without persisting a database catalog key. */
export interface CompleteSnapshotProvenance {
  readonly kind: "catalog" | "decompiler" | "create-sql"
  readonly dialect: string
  readonly path?: readonly (string | number)[]
}

/** Physical-name evidence retained without ephemeral catalog identity keys. */
export interface CompleteSnapshotPhysicalReference {
  readonly kind: CompleteSnapshotObjectKind
  readonly namespace?: string
  readonly table?: string
  readonly name: string
}

/** Namespace identity and selected physical boundary for a snapshot. */
export interface CompleteSnapshotNamespace extends CompleteSnapshotObjectMetadata {
  readonly kind: "generic" | "postgres-schema" | "sqlite-database" | "mysql-database"
  readonly name: string
}

/** Capability facts reported by the adapter that produced the snapshot. */
export interface CompleteSnapshotCapabilities {
  readonly generatedColumns: boolean
  readonly identityMetadata: boolean
  readonly checkConstraints: boolean
  readonly checkConstraintEnforcement: "enforced" | "metadata-only" | "unknown"
  readonly expressionDecompilation: boolean
  readonly indexExpressions: boolean
  readonly indexPredicates: boolean
  readonly indexIncludedColumns: boolean
  readonly namespaces: boolean
  readonly visibility: "complete" | "limited" | "unknown"
  readonly [capability: string]: boolean | string
}

/** Metadata common to every complete snapshot object. */
export interface CompleteSnapshotObjectMetadata {
  readonly provenance?: CompleteSnapshotProvenance
  readonly physicalReference?: CompleteSnapshotPhysicalReference
  readonly dialect?: SnapshotDialectExtension
}

/** A complete snapshot column, including physical ordinal evidence. */
export interface CompleteSnapshotColumn extends CompleteSnapshotObjectMetadata {
  readonly kind: "column"
  readonly id: string
  readonly physicalName: string
  readonly ordinalPosition: number
  readonly nullable: boolean
  readonly hasDefault: boolean
  readonly generated: boolean
  readonly storage?: SnapshotStorage
  readonly default?: SnapshotDefault
  readonly generatedColumn?: SnapshotGeneratedColumn
  readonly identity?: CompleteSnapshotIdentity
  readonly onUpdate?: SnapshotExpression
}

/** A richer identity declaration retained beside a column or sequence. */
export interface CompleteSnapshotIdentity extends CompleteSnapshotObjectMetadata {
  readonly kind: "identity"
  readonly generation: "always" | "by-default"
  readonly options: Readonly<Record<string, CompleteSnapshotValueFact>>
}

/** A literal or opaque expression value in complete object metadata. */
export type CompleteSnapshotValueFact =
  | {
      readonly kind: "literal"
      readonly value: SnapshotLiteral
    }
  | {
      readonly kind: "expression"
      readonly expression: SnapshotExpression
    }

/** An ordered column or expression term in a complete index. */
export type CompleteSnapshotIndexTerm =
  | {
      readonly kind: "column"
      readonly column: string
      readonly position: number
      readonly direction?: "ASC" | "DESC"
      readonly nulls?: "FIRST" | "LAST"
      readonly prefixLength?: CompleteSnapshotValueFact
      readonly operatorClass?: string
    }
  | {
      readonly kind: "expression"
      readonly expression: SnapshotExpression
      readonly position: number
      readonly direction?: "ASC" | "DESC"
      readonly nulls?: "FIRST" | "LAST"
      readonly operatorClass?: string
    }

/** A complete index with engine-specific method and included-column facts. */
export interface CompleteSnapshotIndex extends CompleteSnapshotObjectMetadata {
  readonly kind: "index"
  readonly id: string
  readonly physicalName: string
  readonly terms: readonly CompleteSnapshotIndexTerm[]
  readonly unique: boolean
  readonly candidateKey: boolean
  readonly predicate?: SnapshotExpression
  readonly includedColumns?: readonly string[]
  readonly backingConstraint?: CompleteSnapshotObjectReference
  readonly method?: string
}

/** A key or uniqueness constraint in a complete table. */
export interface CompleteSnapshotKeyConstraint extends CompleteSnapshotObjectMetadata {
  readonly kind: "primary-key" | "unique" | "unique-constraint"
  readonly id: string
  readonly physicalName: string
  readonly columns: readonly string[]
  readonly nulls?: "distinct" | "not-distinct"
  readonly backingIndex?: CompleteSnapshotObjectReference
  readonly deferrable?: boolean
  readonly initially?: "immediate" | "deferred"
  readonly validated?: boolean
}

/** A foreign key with explicit target object identity and actions. */
export interface CompleteSnapshotForeignKey extends CompleteSnapshotObjectMetadata {
  readonly kind: "foreign-key"
  readonly id: string
  readonly physicalName: string
  readonly columns: readonly string[]
  readonly target: {
    readonly table: CompleteSnapshotObjectReference
    readonly columns: readonly string[]
  }
  readonly onUpdate?: "no-action" | "restrict" | "cascade" | "set-null" | "set-default"
  readonly onDelete?: "no-action" | "restrict" | "cascade" | "set-null" | "set-default"
  readonly match?: "simple" | "full" | "partial"
  readonly deferrable?: boolean
  readonly initially?: "immediate" | "deferred"
  readonly validated?: boolean
}

/** A check constraint whose expression remains tagged data. */
export interface CompleteSnapshotCheckConstraint extends CompleteSnapshotObjectMetadata {
  readonly kind: "check"
  readonly id: string
  readonly physicalName: string
  readonly expression: SnapshotExpression
  readonly deferrable?: boolean
  readonly initially?: "immediate" | "deferred"
  readonly validated?: boolean
}

/** Every constraint represented by the complete neutral snapshot model. */
export type CompleteSnapshotConstraint =
  | CompleteSnapshotKeyConstraint
  | CompleteSnapshotForeignKey
  | CompleteSnapshotCheckConstraint

/** A complete table record keyed by stable logical identity. */
export interface CompleteSnapshotTable extends CompleteSnapshotObjectMetadata {
  readonly kind: "table"
  readonly id: string
  readonly physicalName: string
  readonly columns: readonly CompleteSnapshotColumn[]
  readonly constraints: readonly CompleteSnapshotConstraint[]
  readonly indexes: readonly CompleteSnapshotIndex[]
}

/** A view or materialized-view declaration and its output columns. */
export interface CompleteSnapshotView extends CompleteSnapshotObjectMetadata {
  readonly kind: "view" | "materialized-view"
  readonly id: string
  readonly physicalName: string
  readonly columns: readonly CompleteSnapshotColumn[]
  readonly definition: SnapshotExpression
  readonly dependencies?: readonly CompleteSnapshotObjectReference[]
  readonly checkOption?: "none" | "local" | "cascaded"
  readonly securityBarrier?: boolean
  readonly securityInvoker?: boolean
}

/** A sequence and its exact option facts. */
export interface CompleteSnapshotSequence extends CompleteSnapshotObjectMetadata {
  readonly kind: "sequence"
  readonly id: string
  readonly physicalName: string
  readonly storage?: SnapshotStorage
  readonly start?: CompleteSnapshotValueFact
  readonly increment?: CompleteSnapshotValueFact
  readonly minimum?: CompleteSnapshotValueFact
  readonly maximum?: CompleteSnapshotValueFact
  readonly cache?: CompleteSnapshotValueFact
  readonly cycle?: boolean
  readonly ownedBy?: CompleteSnapshotObjectReference
  readonly identity?: CompleteSnapshotIdentity
}

/** An ordered enum declaration. */
export interface CompleteSnapshotEnum extends CompleteSnapshotObjectMetadata {
  readonly kind: "enum"
  readonly id: string
  readonly physicalName: string
  readonly values: readonly {
    readonly value: string
    readonly ordinalPosition: number
    readonly provenance?: CompleteSnapshotProvenance
  }[]
}

/** A domain declaration and its base type constraints. */
export interface CompleteSnapshotDomain extends CompleteSnapshotObjectMetadata {
  readonly kind: "domain"
  readonly id: string
  readonly physicalName: string
  readonly storage: SnapshotStorage
  readonly nullable?: boolean
  readonly default?: CompleteSnapshotValueFact
  readonly constraints?: readonly CompleteSnapshotCheckConstraint[]
}

/** Collation behavior that can affect deterministic schema comparison. */
export interface CompleteSnapshotCollation extends CompleteSnapshotObjectMetadata {
  readonly kind: "collation"
  readonly id: string
  readonly physicalName: string
  readonly provider?: string
  readonly locale?: string
  readonly deterministic?: boolean
  readonly version?: string
}

/** Trigger declaration attached to a table or view. */
export interface CompleteSnapshotTrigger extends CompleteSnapshotObjectMetadata {
  readonly kind: "trigger"
  readonly id: string
  readonly physicalName: string
  readonly table: CompleteSnapshotObjectReference
  readonly timing: "before" | "after" | "instead-of" | "unknown"
  readonly events: readonly ("insert" | "update" | "delete" | "truncate")[]
  readonly orientation?: "row" | "statement"
  readonly condition?: SnapshotExpression
  readonly body: SnapshotExpression
  readonly enabled?: boolean
}

/** Routine argument declaration. */
export interface CompleteSnapshotRoutineParameter {
  readonly name?: string
  readonly mode?: "in" | "out" | "inout" | "variadic" | "table"
  readonly storage: SnapshotStorage
  readonly default?: CompleteSnapshotValueFact
  readonly ordinalPosition: number
}

/** Function, procedure, aggregate, or window routine declaration. */
export interface CompleteSnapshotRoutine extends CompleteSnapshotObjectMetadata {
  readonly kind: "routine"
  readonly id: string
  readonly physicalName: string
  readonly routineKind: "function" | "procedure" | "aggregate" | "window" | "unknown"
  readonly parameters: readonly CompleteSnapshotRoutineParameter[]
  readonly returnType?: SnapshotStorage
  readonly language?: string
  readonly body?: SnapshotExpression
  readonly volatility?: "immutable" | "stable" | "volatile" | "unknown"
  readonly parallel?: "safe" | "restricted" | "unsafe" | "unknown"
  readonly security?: "invoker" | "definer" | "unknown"
  readonly dependencies?: readonly CompleteSnapshotObjectReference[]
}

/** A partition child, its parent, and normalized bound expression. */
export interface CompleteSnapshotPartition extends CompleteSnapshotObjectMetadata {
  readonly kind: "partition"
  readonly id: string
  readonly physicalName: string
  readonly parent: CompleteSnapshotObjectReference
  readonly strategy: "range" | "list" | "hash" | "reference" | "unknown"
  readonly keyColumns?: readonly string[]
  readonly bound?: SnapshotExpression
  readonly default?: boolean
}

/** A row-level security policy attached to a table. */
export interface CompleteSnapshotPolicy extends CompleteSnapshotObjectMetadata {
  readonly kind: "policy"
  readonly id: string
  readonly physicalName: string
  readonly table: CompleteSnapshotObjectReference
  readonly command: "all" | "select" | "insert" | "update" | "delete" | "unknown"
  readonly roles?: readonly string[]
  readonly permissive?: boolean
  readonly using?: SnapshotExpression
  readonly check?: SnapshotExpression
}

/** An extension object with a typed, versioned payload. */
export interface CompleteSnapshotExtension extends CompleteSnapshotObjectMetadata {
  readonly kind: "extension"
  readonly id: string
  readonly physicalName: string
  readonly extensionName: string
  readonly extensionVersion?: string
  readonly schema?: string
  readonly data: SnapshotJsonValue
  readonly configuration?: SnapshotJsonValue
}

/** A deferred object retained as a reviewable, non-lossy boundary record. */
export interface CompleteSnapshotDeferredObject extends CompleteSnapshotObjectMetadata {
  readonly kind: "deferred-object"
  readonly id: string
  readonly objectKind: string
  readonly physicalName: string
  readonly reason?: string
  readonly data?: SnapshotJsonValue
}

/** An opaque object observed by an adapter but not yet structurally modeled. */
export interface CompleteSnapshotOpaqueObject extends CompleteSnapshotObjectMetadata {
  readonly kind: "opaque-object"
  readonly id: string
  readonly objectKind: string
  readonly physicalName: string
  readonly data: SnapshotJsonValue
  readonly sql?: SnapshotExpression
}

/** A comment attached to a stable logical object. */
export interface CompleteSnapshotComment extends CompleteSnapshotObjectMetadata {
  readonly kind: "comment"
  readonly id: string
  readonly physicalName: string
  readonly object: CompleteSnapshotObjectReference
  readonly text: string
}

/** Ownership metadata attached to a stable logical object. */
export interface CompleteSnapshotOwnership extends CompleteSnapshotObjectMetadata {
  readonly kind: "ownership"
  readonly id: string
  readonly physicalName: string
  readonly object: CompleteSnapshotObjectReference
  readonly owner: string
}

/** Every complete snapshot object family, including retained boundaries. */
export type CompleteSnapshotObject =
  | CompleteSnapshotTable
  | CompleteSnapshotView
  | CompleteSnapshotSequence
  | CompleteSnapshotEnum
  | CompleteSnapshotDomain
  | CompleteSnapshotCollation
  | CompleteSnapshotTrigger
  | CompleteSnapshotRoutine
  | CompleteSnapshotPartition
  | CompleteSnapshotPolicy
  | CompleteSnapshotExtension
  | CompleteSnapshotDeferredObject
  | CompleteSnapshotOpaqueObject
  | CompleteSnapshotComment
  | CompleteSnapshotOwnership

/** The immutable strict Snapshot v1 envelope. */
export interface CompleteSchemaSnapshot {
  readonly format: typeof completeSchemaSnapshotFormat
  readonly version: typeof completeSchemaSnapshotVersion
  readonly dialect: SnapshotDialect
  readonly namingPolicy: SnapshotNamingPolicy
  readonly namespace: CompleteSnapshotNamespace
  readonly capabilities: CompleteSnapshotCapabilities
  readonly tables: readonly CompleteSnapshotTable[]
  readonly views: readonly CompleteSnapshotView[]
  readonly sequences: readonly CompleteSnapshotSequence[]
  readonly enums: readonly CompleteSnapshotEnum[]
  readonly domains: readonly CompleteSnapshotDomain[]
  readonly collations: readonly CompleteSnapshotCollation[]
  readonly triggers: readonly CompleteSnapshotTrigger[]
  readonly routines: readonly CompleteSnapshotRoutine[]
  readonly partitions: readonly CompleteSnapshotPartition[]
  readonly policies: readonly CompleteSnapshotPolicy[]
  readonly extensions: readonly CompleteSnapshotExtension[]
  readonly deferredObjects: readonly CompleteSnapshotDeferredObject[]
  readonly opaqueObjects: readonly CompleteSnapshotOpaqueObject[]
  readonly comments: readonly CompleteSnapshotComment[]
  readonly ownership: readonly CompleteSnapshotOwnership[]
}

/** Input accepted by the strict complete snapshot encoder. */
export type CompleteSchemaSnapshotInput = CompleteSchemaSnapshot | Readonly<Record<string, unknown>>

/** A complete snapshot decoder result with immutable successful output. */
export type CompleteSnapshotDecodeResult =
  | {
      readonly ok: true
      readonly value: CompleteSchemaSnapshot
    }
  | {
      readonly ok: false
      readonly diagnostics: readonly import("./types.ts").SnapshotDiagnostic[]
    }

/** A complete snapshot creation result with immutable successful output. */
export type CompleteSnapshotCreateResult = CompleteSnapshotDecodeResult

/** V1 aliases kept explicit for consumers that prefer numbered APIs. */
export type SchemaSnapshotV1 = CompleteSchemaSnapshot
export type SchemaSnapshotV1Input = CompleteSchemaSnapshotInput
export type SchemaSnapshotV1DecodeResult = CompleteSnapshotDecodeResult
