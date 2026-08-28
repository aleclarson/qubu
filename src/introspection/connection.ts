import type { CatalogDialect, CatalogQueryRow } from "./types.ts"

/** A parameterized statement owned by a catalog adapter. */
export interface CatalogQuery {
  /** Fixed catalog SQL selected by Qubu's dialect adapter. */
  readonly text: string
  /** Values bound by the user-owned connection or driver adapter. */
  readonly parameters: readonly unknown[]
}

/** Optional execution controls passed through to a catalog connection. */
export interface CatalogQueryOptions {
  /** Abort propagation is optional because drivers expose it inconsistently. */
  readonly signal?: AbortSignal
}

/**
 * User-owned catalog query boundary.
 *
 * Qubu does not select a driver, open or close a connection, manage a pool, authenticate, retry,
 * start a transaction, or impose a timeout. The connection only executes fixed, parameterized
 * catalog statements and returns already-decoded row records.
 */
export interface CatalogConnection {
  readonly dialect: CatalogDialect
  query<TRow extends CatalogQueryRow = CatalogQueryRow>(
    statement: CatalogQuery,
    options?: CatalogQueryOptions,
  ): Promise<readonly TRow[]>
}
