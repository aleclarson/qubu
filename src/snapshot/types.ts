import type { DialectCapability } from "../core/dialect.ts"
import type { PortableColumnStorage, NativeColumnStorage } from "../schema/column.ts"
import type { SchemaDialect } from "../schema/dialect.ts"
import type { Schema } from "../schema/registry.ts"
import type {
  CompleteSchemaSnapshot,
  CompleteSchemaSnapshotInput,
  CompleteSnapshotCheckConstraint,
  CompleteSnapshotColumn,
  CompleteSnapshotConstraint,
  CompleteSnapshotForeignKey,
  CompleteSnapshotIdentity,
  CompleteSnapshotIndex,
  CompleteSnapshotIndexTerm,
  CompleteSnapshotKeyConstraint,
  CompleteSnapshotTable,
  CompleteSnapshotCreateResult,
  CompleteSnapshotDecodeResult,
} from "./complete-types.ts"

/** The JSON object tag used by Qubu schema snapshots. */
export const schemaSnapshotFormat = "qubu-schema" as const

/** The current canonical schema snapshot format version. */
export const schemaSnapshotVersion = 1 as const

/** The first version of the dialect-extension envelope. */
export const schemaSnapshotDialectVersion = 1 as const

/** The first version of the built-in naming-policy description. */
export const schemaSnapshotNamingPolicyVersion = 1 as const

/** The neutral dialect used when no SQL engine adapter is selected. */
export const neutralSnapshotDialect: SnapshotDialect = Object.freeze({
  name: "neutral",
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
  readonly $number: "NaN" | "Infinity" | "-Infinity"
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
      readonly kind: "portable"
      readonly type: string
    }
  | {
      readonly kind: "native"
      readonly dialect: string
      readonly type: string
      /** SQLite's derived type affinity, when the selected adapter records it. */
      readonly affinity?: "blob" | "integer" | "numeric" | "real" | "text"
    }

/** A deterministic expression after it crosses the snapshot data boundary. */
export interface SnapshotExpression {
  readonly kind: "expression"
  readonly expressionKind: string
  /** Canonical parameter-free text for the selected schema expression dialect. */
  readonly sql: string
  /** Present only for an explicitly dialect-tagged unsafe expression. */
  readonly dialect?: string
}

/** A default value retained independently from insert-write behavior. */
export type SnapshotDefault =
  | {
      readonly kind: "literal"
      readonly value: SnapshotLiteral
    }
  | {
      readonly kind: "expression"
      readonly expression: SnapshotExpression
    }
  | {
      readonly kind: "external"
    }

/** Canonical literal values accepted by neutral schema metadata. */
export type SnapshotLiteral =
  | { readonly kind: "null" }
  | {
      readonly kind: "boolean"
      readonly value: boolean
    }
  | {
      readonly kind: "string"
      readonly value: string
    }
  | {
      readonly kind: "number"
      readonly value: string
    }
  | {
      readonly kind: "bigint"
      readonly value: string
    }

/** A generated-column expression and its storage mode. */
export type SnapshotGeneratedColumn =
  | {
      readonly kind: "expression"
      readonly expression: SnapshotExpression
      readonly mode: "stored" | "virtual"
    }
  | {
      readonly kind: "external"
    }

/** V1 object aliases kept in the short snapshot vocabulary used by consumers. */
export type SnapshotIdentity = CompleteSnapshotIdentity
export type SnapshotColumn = CompleteSnapshotColumn
export type SnapshotIndexTerm = CompleteSnapshotIndexTerm
/** The expression portion of an index term, without ordering metadata. */
export type SnapshotIndexTermExpression =
  | {
      readonly kind: "column"
      readonly column: string
    }
  | {
      readonly kind: "expression"
      readonly expression: SnapshotExpression
    }
export type SnapshotKeyConstraint = CompleteSnapshotKeyConstraint
export type SnapshotUniqueConstraint = CompleteSnapshotKeyConstraint & {
  readonly kind: "unique-constraint"
}
export type SnapshotForeignKey = CompleteSnapshotForeignKey
export type SnapshotCheckConstraint = CompleteSnapshotCheckConstraint
export type SnapshotConstraint = CompleteSnapshotConstraint
export type SnapshotIndex = CompleteSnapshotIndex
export type SnapshotTable = CompleteSnapshotTable
export type SchemaSnapshot = CompleteSchemaSnapshot

/** Schema-expression context supplied to a dialect adapter. */
export interface SnapshotExpressionContext {
  readonly mode: "default" | "generated" | "check" | "index"
  readonly path: readonly (string | number)[]
  readonly dialect: SchemaDialect
}

/** Storage context supplied to a dialect adapter. */
export interface SnapshotStorageContext {
  readonly path: readonly (string | number)[]
  readonly dialect: SchemaDialect
}

/** Extension context supplied to a dialect adapter. */
export interface SnapshotExtensionContext {
  readonly path: readonly (string | number)[]
  readonly dialect: SchemaDialect
}

/** Context supplied to an adapter's dialect-capability validation hook. */
export interface SnapshotValidationContext {
  readonly path: readonly (string | number)[]
  readonly dialect: SchemaDialect
}

/**
 * Adapter boundary for the common traversal. Schema hooks live on `dialect.schema`; the adapter
 * only selects that schema dialect, so PostgreSQL, SQLite, and MySQL can share the query rendering
 * policy without taking ownership of canonical ordering or cross-reference validation.
 */
export interface SchemaSnapshotAdapter<
  TCapabilities extends DialectCapability = DialectCapability,
> {
  /** The query dialect plus its schema hooks and metadata. */
  readonly dialect: SchemaDialect<TCapabilities>
}

/** Structured diagnostic categories emitted by snapshot tooling. */
export type SnapshotDiagnosticCode =
  | "invalid-schema"
  | "invalid-value"
  | "unsupported-expression"
  | "dialect-mismatch"
  | "unresolved-reference"
  | "invalid-snapshot"
  | "unknown-field"
  | "future-version"
  | "invalid-cross-reference"
  | "non-canonical"
  | "unsupported-dialect-option"

/** A path-addressed snapshot diagnostic suitable for CLI or editor output. */
export interface SnapshotDiagnostic {
  readonly code: SnapshotDiagnosticCode
  readonly message: string
  readonly path: readonly (string | number)[]
  readonly relatedPaths?: readonly (readonly (string | number)[])[]
}

/** Result returned by the strict snapshot decoder. */
export type SnapshotDecodeResult = CompleteSnapshotDecodeResult

/** Result returned by a non-throwing schema traversal helper. */
export type SnapshotCreateResult = CompleteSnapshotCreateResult

/** A schema snapshot input accepted by the canonical encoder. */
export type SchemaSnapshotInput = CompleteSchemaSnapshotInput

/** Expose the schema generic in tooling declarations without widening APIs. */
export type AnySchema = Schema<any>

/** Keep the storage branches discoverable from the tooling entry point. */
export type { PortableColumnStorage, NativeColumnStorage }
