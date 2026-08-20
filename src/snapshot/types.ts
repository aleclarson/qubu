import type { AnyExpression } from '../expressions/types.ts'
import type {
  ColumnStorage,
  PortableColumnStorage,
  NativeColumnStorage,
} from '../schema/column.ts'
import type { SchemaDialectExtension } from '../schema/metadata.ts'
import type { Schema } from '../schema/registry.ts'

/** The JSON object tag used by Qubu schema snapshots. */
export const schemaSnapshotFormat = 'qubu-schema' as const

/** The first canonical schema snapshot format version. */
export const schemaSnapshotVersion = 1 as const

/** The first version of the dialect-extension envelope. */
export const schemaSnapshotDialectVersion = 1 as const

/** The first version of the built-in naming-policy description. */
export const schemaSnapshotNamingPolicyVersion = 1 as const

/** The neutral dialect used when no SQL engine adapter is selected. */
export const neutralSnapshotDialect: SnapshotDialect = Object.freeze({
  name: 'neutral',
  version: schemaSnapshotDialectVersion,
})

/** A dialect identifier and independently versioned extension contract. */
export interface SnapshotDialect {
  readonly name: string
  readonly version: number
}

/** Naming-policy identity retained by a snapshot, without executable code. */
export interface SnapshotNamingPolicy {
  readonly name: string
  readonly version: number
}

/** A JSON-safe representation of a non-finite JavaScript number. */
export interface SnapshotSpecialNumber {
  readonly $number: 'NaN' | 'Infinity' | '-Infinity'
}

/** A JSON-safe representation of a JavaScript bigint. */
export interface SnapshotBigInt {
  readonly $bigint: string
}

/** Values accepted inside versioned dialect extension data. */
export type SnapshotJsonValue =
  | null
  | boolean
  | string
  | number
  | SnapshotSpecialNumber
  | SnapshotBigInt
  | readonly SnapshotJsonValue[]
  | { readonly [key: string]: SnapshotJsonValue }

/** A dialect-owned payload kept separate from portable schema facts. */
export interface SnapshotDialectExtension {
  readonly dialect: string
  readonly version: number
  readonly data: SnapshotJsonValue
}

/** A portable or dialect-owned physical column declaration. */
export type SnapshotStorage =
  | {
      readonly kind: 'portable'
      readonly type: string
    }
  | {
      readonly kind: 'native'
      readonly dialect: string
      readonly type: string
      /** SQLite's derived type affinity, when the selected adapter records it. */
      readonly affinity?: 'blob' | 'integer' | 'numeric' | 'real' | 'text'
    }

/** A deterministic expression after it crosses the snapshot data boundary. */
export interface SnapshotExpression {
  readonly kind: 'expression'
  readonly expressionKind: string
  /** Canonical parameter-free text for the selected schema expression dialect. */
  readonly sql: string
  /** Present only for an explicitly dialect-tagged unsafe expression. */
  readonly dialect?: string
}

/** A default value retained independently from insert-write behavior. */
export type SnapshotDefault =
  | {
      readonly kind: 'literal'
      readonly value: SnapshotLiteral
    }
  | {
      readonly kind: 'expression'
      readonly expression: SnapshotExpression
    }
  | {
      readonly kind: 'external'
    }

/** Canonical literal values accepted by neutral schema metadata. */
export type SnapshotLiteral =
  | { readonly kind: 'null' }
  | { readonly kind: 'boolean'; readonly value: boolean }
  | { readonly kind: 'string'; readonly value: string }
  | { readonly kind: 'number'; readonly value: string }
  | { readonly kind: 'bigint'; readonly value: string }

/** A generated-column expression and its storage mode. */
export type SnapshotGeneratedColumn =
  | {
      readonly kind: 'expression'
      readonly expression: SnapshotExpression
      readonly mode: 'stored' | 'virtual'
    }
  | {
      readonly kind: 'external'
    }

/** Identity behavior is deliberately separate from generated expressions. */
export interface SnapshotIdentity {
  readonly kind: 'identity'
  readonly generation: 'always' | 'by-default'
  readonly dialect?: SnapshotDialectExtension
}

/** A canonical column record keyed by its stable logical field ID. */
export interface SnapshotColumn {
  readonly id: string
  readonly physicalName: string
  readonly nullable: boolean
  readonly hasDefault: boolean
  readonly generated: boolean
  readonly storage?: SnapshotStorage
  readonly default?: SnapshotDefault
  readonly generatedColumn?: SnapshotGeneratedColumn
  readonly identity?: SnapshotIdentity
  /** MySQL's parameter-free column update expression, when supported. */
  readonly onUpdate?: SnapshotExpression
}

/** An expression or bare column used by an index. */
export type SnapshotIndexTermExpression =
  | {
      readonly kind: 'column'
      readonly column: string
    }
  | {
      readonly kind: 'expression'
      readonly expression: SnapshotExpression
    }

/** One ordered index term. */
export type SnapshotIndexTerm =
  | SnapshotIndexTermExpression
  | {
      readonly kind: 'order'
      readonly expression: SnapshotIndexTermExpression
      readonly direction?: 'ASC' | 'DESC'
      readonly nulls?: 'FIRST' | 'LAST'
    }

/** Common key metadata shared by primary and strict unique constraints. */
export interface SnapshotKeyConstraint {
  readonly id: string
  readonly kind: 'primary-key' | 'unique'
  readonly physicalName: string
  readonly columns: readonly string[]
  readonly deferrable?: boolean
  readonly initially?: 'immediate' | 'deferred'
  readonly dialect?: SnapshotDialectExtension
}

/** Nullable database uniqueness, intentionally not a candidate-key proof. */
export interface SnapshotUniqueConstraint {
  readonly id: string
  readonly kind: 'unique-constraint'
  readonly physicalName: string
  readonly columns: readonly string[]
  readonly nulls: 'distinct' | 'not-distinct'
  readonly deferrable?: boolean
  readonly initially?: 'immediate' | 'deferred'
  readonly dialect?: SnapshotDialectExtension
}

/** A foreign key whose target is represented only by logical IDs. */
export interface SnapshotForeignKey {
  readonly id: string
  readonly kind: 'foreign-key'
  readonly physicalName: string
  readonly columns: readonly string[]
  readonly target: {
    readonly table: string
    readonly columns: readonly string[]
  }
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
  readonly dialect?: SnapshotDialectExtension
}

/** A table check constraint with a detached expression value. */
export interface SnapshotCheckConstraint {
  readonly id: string
  readonly kind: 'check'
  readonly physicalName: string
  readonly expression: SnapshotExpression
  readonly deferrable?: boolean
  readonly initially?: 'immediate' | 'deferred'
  readonly dialect?: SnapshotDialectExtension
}

/** Every constraint represented by the v1 neutral model. */
export type SnapshotConstraint =
  | SnapshotKeyConstraint
  | SnapshotUniqueConstraint
  | SnapshotForeignKey
  | SnapshotCheckConstraint

/** A canonical index record keyed by its stable logical ID. */
export interface SnapshotIndex {
  readonly id: string
  readonly kind: 'index'
  readonly physicalName: string
  readonly terms: readonly SnapshotIndexTerm[]
  readonly unique: boolean
  readonly candidateKey: boolean
  readonly predicate?: SnapshotExpression
  readonly includedColumns?: readonly string[]
  readonly dialect?: SnapshotDialectExtension
}

/** A table record keyed by its stable logical registry ID. */
export interface SnapshotTable {
  readonly id: string
  readonly physicalName: string
  readonly columns: readonly SnapshotColumn[]
  readonly constraints: readonly SnapshotConstraint[]
  readonly indexes: readonly SnapshotIndex[]
}

/** The immutable canonical schema snapshot envelope. */
export interface SchemaSnapshot {
  readonly format: typeof schemaSnapshotFormat
  readonly version: typeof schemaSnapshotVersion
  readonly dialect: SnapshotDialect
  readonly namingPolicy: SnapshotNamingPolicy
  readonly namespace?: string
  readonly tables: readonly SnapshotTable[]
}

/** Schema-expression context supplied to a dialect adapter. */
export interface SnapshotExpressionContext {
  readonly mode: 'default' | 'generated' | 'check' | 'index'
  readonly path: readonly (string | number)[]
  readonly dialect: SnapshotDialect
}

/** Storage context supplied to a dialect adapter. */
export interface SnapshotStorageContext {
  readonly path: readonly (string | number)[]
  readonly dialect: SnapshotDialect
}

/** Extension context supplied to a dialect adapter. */
export interface SnapshotExtensionContext {
  readonly path: readonly (string | number)[]
  readonly dialect: SnapshotDialect
}

/** Context supplied to an adapter's dialect-capability validation hook. */
export interface SnapshotValidationContext {
  readonly path: readonly (string | number)[]
  readonly dialect: SnapshotDialect
}

/**
 * Dialect-owned hooks used by the common traversal. Commit 6 supplies the
 * neutral fallback; PostgreSQL, SQLite, and MySQL adapters can implement this
 * contract without taking ownership of canonical ordering or cross-reference
 * validation.
 */
export interface SchemaSnapshotAdapter {
  readonly dialect: SnapshotDialect
  readonly namingPolicy?: SnapshotNamingPolicy
  /**
   * Report dialect capability findings before common traversal starts. The
   * common serializer owns diagnostic aggregation and ordering; adapters own
   * version- or engine-specific checks.
   */
  readonly validate?: (
    schema: Schema<any>,
    context: SnapshotValidationContext
  ) => readonly SnapshotDiagnostic[]
  readonly encodeStorage?: (
    storage: ColumnStorage,
    context: SnapshotStorageContext
  ) => SnapshotStorage
  readonly encodeExpression?: (
    expression: AnyExpression,
    context: SnapshotExpressionContext
  ) => SnapshotExpression
  readonly encodeDialectExtension?: (
    extension: SchemaDialectExtension,
    context: SnapshotExtensionContext
  ) => SnapshotDialectExtension
}

/** Structured diagnostic categories emitted by snapshot tooling. */
export type SnapshotDiagnosticCode =
  | 'invalid-schema'
  | 'invalid-value'
  | 'unsupported-expression'
  | 'dialect-mismatch'
  | 'unresolved-reference'
  | 'invalid-snapshot'
  | 'unknown-field'
  | 'future-version'
  | 'invalid-cross-reference'
  | 'non-canonical'
  | 'unsupported-dialect-option'

/** A path-addressed snapshot diagnostic suitable for CLI or editor output. */
export interface SnapshotDiagnostic {
  readonly code: SnapshotDiagnosticCode
  readonly message: string
  readonly path: readonly (string | number)[]
  readonly relatedPaths?: readonly (readonly (string | number)[])[]
}

/** Result returned by the strict snapshot decoder. */
export type SnapshotDecodeResult =
  | { readonly ok: true; readonly value: SchemaSnapshot }
  | { readonly ok: false; readonly diagnostics: readonly SnapshotDiagnostic[] }

/** Result returned by a non-throwing schema traversal helper. */
export type SnapshotCreateResult =
  | { readonly ok: true; readonly value: SchemaSnapshot }
  | { readonly ok: false; readonly diagnostics: readonly SnapshotDiagnostic[] }

/** A schema snapshot input accepted by the canonical encoder. */
export type SchemaSnapshotInput =
  | SchemaSnapshot
  | Readonly<Record<string, unknown>>

/** Expose the schema generic in tooling declarations without widening APIs. */
export type AnySchema = Schema<any>

/** Keep the storage branches discoverable from the tooling entry point. */
export type { PortableColumnStorage, NativeColumnStorage }
