import type { SchemaSnapshot } from '../snapshot/types.ts'
import type { CatalogEntityKind } from './types.ts'

/** The source selected by the stable introspection identity precedence. */
export type CatalogIdentitySource =
  | 'explicit-hint'
  | 'previous-snapshot'
  | 'physical-name'
  | 'deterministic-fallback'

/** Entity kinds for which a caller may provide a logical identity hint. */
export type CatalogIdentityEntityKind = Exclude<
  CatalogEntityKind,
  'namespace' | 'deferred-object'
>

/** A physical selector for one table-scoped or namespace-scoped entity. */
export interface CatalogIdentityHint {
  readonly kind: CatalogIdentityEntityKind
  /** Logical ID to retain in the normalized catalog and later snapshot. */
  readonly logicalId: string
  /** Current physical name of the selected object. */
  readonly physicalName: string
  /** Physical table name for columns, constraints, and indexes. */
  readonly tablePhysicalName?: string
}

/** The caller-provided identity hints accepted by an introspection run. */
export type CatalogIdentityHints = readonly CatalogIdentityHint[]

/** How invalid physical names become deterministic logical IDs. */
export type CatalogIdentityFallback = 'escaped' | 'hashed'

/** Versioned metadata for the identity policy used by one introspection run. */
export interface CatalogIdentityPolicy {
  readonly name: string
  readonly version: number
  readonly fallback: CatalogIdentityFallback
  readonly precedence: readonly CatalogIdentitySource[]
}

/** The naming policy used by the first introspection snapshot mapper. */
export const introspectedPhysicalIdentityPolicy: CatalogIdentityPolicy =
  Object.freeze({
    name: 'introspected-physical',
    version: 1,
    fallback: 'escaped',
    precedence: Object.freeze([
      'explicit-hint',
      'previous-snapshot',
      'physical-name',
      'deterministic-fallback',
    ] as const),
  })

/** A resolved logical ID together with the rule that selected it. */
export interface CatalogResolvedIdentity {
  readonly logicalId: string
  readonly source: CatalogIdentitySource
}

/**
 * Inputs used when carrying a prior snapshot's table and column IDs forward.
 * The resolver must match physical names inside the selected namespace only.
 */
export interface CatalogPreviousSnapshotIdentitySource {
  readonly snapshot: SchemaSnapshot
}
