import type { IntrospectionDiagnostic } from '../introspection/diagnostics.ts'
import type {
  CatalogClassificationConfidence,
  CatalogDialect,
  CatalogPortableStorageType,
} from '../introspection/types.ts'

/** TypeScript value types that the controlled source printer can emit. */
export type CodegenApplicationType =
  | 'unknown'
  | 'string'
  | 'number'
  | 'boolean'
  | 'bigint'
  | 'Date'
  | 'Uint8Array'

/** Qubu SQL semantic domains that generated columns can carry. */
export type CodegenSqlDomain =
  | 'unknown'
  | 'integer'
  | 'decimal'
  | 'text'
  | 'boolean'
  | 'date'
  | 'timestamp'
  | 'uuid'
  | 'json'
  | 'bigint'
  | 'binary'

/** One logical-name decision exposed to a generator naming callback. */
export interface CodegenNameContext {
  readonly kind: 'schema' | 'table' | 'column' | 'constraint' | 'index'
  readonly physicalName: string
  readonly suggestedName: string
  readonly tablePhysicalName?: string
  readonly tableName?: string
}

/** Catalog facts available to a controlled column mapping callback. */
export interface CodegenColumnContext {
  readonly dialect: CatalogDialect
  readonly namespace: string
  readonly tablePhysicalName: string
  readonly tableName: string
  readonly columnPhysicalName: string
  readonly columnName: string
  readonly nativeType: string
  readonly portableType?: CatalogPortableStorageType
  readonly classificationConfidence?: CatalogClassificationConfidence
  readonly suggestedSqlDomain: CodegenSqlDomain
}

/** Trusted type choices for one generated column. */
export interface CodegenColumnMapping {
  /** Selected application value type. Defaults to `unknown`. */
  readonly output?: CodegenApplicationType
  /** Insert value type. Defaults to `unknown`. */
  readonly insert?: CodegenApplicationType
  /** Update value type. Defaults to `unknown`. */
  readonly update?: CodegenApplicationType
  /** SQL semantic domain. Defaults to the conservative catalog mapping. */
  readonly sqlDomain?: CodegenSqlDomain
}

/** Controlled customization points for generated logical names and types. */
export interface SchemaCodegenOptions {
  /**
   * Override one suggested camelCase name. The returned value must still be a
   * safe camelCase logical ID, and table and schema names must be valid export
   * bindings.
   */
  readonly naming?: (context: CodegenNameContext) => string | undefined
  /**
   * Override trusted application types or a Qubu SQL domain for one column.
   * The callback selects from fixed tokens and cannot inject source text.
   */
  readonly mapColumn?: (
    context: CodegenColumnContext
  ) => CodegenColumnMapping | undefined
}

/** Stable generator findings added beside retained introspection diagnostics. */
export type CodegenDiagnosticCode =
  | IntrospectionDiagnostic['code']
  | 'invalid-input'
  | 'lossy-input'
  | 'unsupported-snapshot'
  | 'omitted-fact'
  | 'unsafe-name'
  | 'name-collision'
  | 'invalid-option'
  | 'unrepresentable-fact'
  | 'excluded-object-family'
  | 'unsafe-source'

/** A path-addressed finding returned by schema source generation. */
export interface CodegenDiagnostic
  extends Omit<IntrospectionDiagnostic, 'code'> {
  readonly code: CodegenDiagnosticCode
  readonly relatedPaths?: readonly (readonly (string | number)[])[]
}

/** Successful source generation with all retained warnings and information. */
export interface SchemaCodegenSuccess {
  readonly ok: true
  readonly source: string
  readonly diagnostics: readonly CodegenDiagnostic[]
}

/** Failed generation. No partial source is returned. */
export interface SchemaCodegenFailure {
  readonly ok: false
  readonly source?: never
  readonly diagnostics: readonly CodegenDiagnostic[]
}

/** Non-throwing result returned by schema source generation. */
export type SchemaCodegenResult = SchemaCodegenSuccess | SchemaCodegenFailure
