import type { Dialect, DialectCapability } from "../core/dialect.ts"
import type { AnyExpression } from "../expressions/types.ts"
import type {
  SnapshotDialectExtension,
  SnapshotExpression,
  SnapshotExpressionContext,
  SnapshotExtensionContext,
  SnapshotNamingPolicy,
  SnapshotStorage,
  SnapshotStorageContext,
  SnapshotValidationContext,
  SnapshotDiagnostic,
} from "../snapshot/types.ts"
import type { ColumnStorage } from "./column.ts"
import type { SchemaDialectExtension } from "./metadata.ts"
import type { Schema } from "./registry.ts"

/**
 * Schema-only behavior layered onto a query dialect.
 *
 * The query policy is deliberately not repeated here: identifier quoting, placeholders, JSON,
 * casts, and capability identity all come from the enclosing {@link SchemaDialect}.
 */
export interface SchemaDialectHooks {
  /** Version of this dialect's schema metadata extension contract. */
  readonly version: number
  /** Optional executable naming policy retained by snapshot metadata. */
  readonly namingPolicy?: SnapshotNamingPolicy
  /** Validate engine-specific schema facts before common traversal. */
  readonly validate?: (
    schema: Schema<any>,
    context: SnapshotValidationContext,
  ) => readonly SnapshotDiagnostic[]
  /** Encode portable or native physical column storage. */
  readonly encodeStorage?: (
    storage: ColumnStorage,
    context: SnapshotStorageContext,
  ) => SnapshotStorage
  /** Encode a deterministic expression for its declaration context. */
  readonly encodeExpression?: (
    expression: AnyExpression,
    context: SnapshotExpressionContext,
  ) => SnapshotExpression
  /** Encode dialect-owned constraint, index, and identity metadata. */
  readonly encodeDialectExtension?: (
    extension: SchemaDialectExtension,
    context: SnapshotExtensionContext,
  ) => SnapshotDialectExtension
}

/**
 * A schema dialect is a strict capability superset of a query dialect.
 *
 * A schema dialect must be created with {@link createSchemaDialect}; that helper preserves the exact
 * query rendering object and adds only schema behavior and snapshot metadata.
 */
export interface SchemaDialect<
  TCapabilities extends string = DialectCapability,
> extends Dialect<TCapabilities> {
  readonly schema: SchemaDialectHooks
}

/**
 * Add schema behavior to an existing query dialect without rebuilding any of its identifier,
 * literal, placeholder, JSON, cast, or capability policies.
 */
export function createSchemaDialect<const TCapabilities extends string = DialectCapability>(
  queryDialect: Dialect<TCapabilities>,
  schema: SchemaDialectHooks,
): SchemaDialect<TCapabilities> {
  return Object.freeze({
    ...queryDialect,
    schema: Object.freeze({ ...schema }),
  })
}
