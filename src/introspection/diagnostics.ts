import type { CatalogReference } from './types.ts'

/** Stable severity levels for discovery and normalization findings. */
export type IntrospectionDiagnosticSeverity = 'error' | 'warning' | 'info'

/** Stable codes emitted by catalog discovery and normalization. */
export type IntrospectionDiagnosticCode =
  | 'connection-failed'
  | 'query-failed'
  | 'permission-denied'
  | 'unsupported-product'
  | 'unsupported-server'
  | 'unsupported-feature'
  | 'invalid-catalog-row'
  | 'missing-catalog-row'
  | 'expression-parse-failed'
  | 'unresolved-reference'
  | 'ambiguous-identity'
  | 'unmodeled-object'
  | 'lossy-mapping'
  | 'dialect-mismatch'
  | 'partial-result'

/** A path-addressed diagnostic from catalog discovery or normalization. */
export interface IntrospectionDiagnostic {
  readonly severity: IntrospectionDiagnosticSeverity
  readonly code: IntrospectionDiagnosticCode
  readonly message: string
  /** Location in the normalized catalog or adapter input being described. */
  readonly path: readonly (string | number)[]
  /** Physical object and current-run catalog identity involved in the issue. */
  readonly physicalReference?: CatalogReference
  /** Other physical objects or current-run references related to the issue. */
  readonly relatedReferences?: readonly CatalogReference[]
  /** Optional action that can resolve or explain the finding. */
  readonly remediation?: string
}

/** Input accepted by {@link createIntrospectionDiagnostic}. */
export type IntrospectionDiagnosticInput = IntrospectionDiagnostic

/**
 * Create one immutable diagnostic without interpreting catalog text or
 * copying driver error details into the structured fields.
 */
export function createIntrospectionDiagnostic(
  diagnostic: IntrospectionDiagnosticInput
): IntrospectionDiagnostic {
  return freezeDiagnostic(diagnostic)
}

/** Return whether a diagnostic list prevents strict introspection output. */
export function hasIntrospectionErrors(
  diagnostics: readonly IntrospectionDiagnostic[]
): boolean {
  return diagnostics.some(diagnostic => diagnostic.severity === 'error')
}

/** Error raised by a throwing introspection operation after collecting findings. */
export class IntrospectionError extends Error {
  readonly name = 'IntrospectionError'
  readonly diagnostics: readonly IntrospectionDiagnostic[]
  readonly issues: readonly IntrospectionDiagnostic[]

  constructor(diagnostics: readonly IntrospectionDiagnostic[]) {
    const frozenDiagnostics = Object.freeze(
      diagnostics.map(diagnostic => freezeDiagnostic(diagnostic))
    )
    super(frozenDiagnostics.map(diagnostic => diagnostic.message).join('\n'))
    this.diagnostics = frozenDiagnostics
    this.issues = frozenDiagnostics
  }
}

function freezeDiagnostic(
  diagnostic: IntrospectionDiagnostic
): IntrospectionDiagnostic {
  return Object.freeze({
    ...diagnostic,
    path: Object.freeze([...diagnostic.path]),
    physicalReference: diagnostic.physicalReference
      ? freezeReference(diagnostic.physicalReference)
      : undefined,
    relatedReferences: diagnostic.relatedReferences
      ? Object.freeze(
          diagnostic.relatedReferences.map(reference =>
            freezeReference(reference)
          )
        )
      : undefined,
  })
}

function freezeReference(reference: CatalogReference): CatalogReference {
  return Object.freeze({
    ...reference,
    catalog: reference.catalog
      ? Object.freeze({ ...reference.catalog })
      : undefined,
  })
}
