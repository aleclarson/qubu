import { mapCatalogToCompleteSnapshot } from "./complete-snapshot.ts"
import type { IntrospectionCatalog, IntrospectionOptions, IntrospectionResult } from "./types.ts"

/**
 * Map a normalized catalog to the canonical Snapshot v1 object model.
 *
 * Snapshot identity and namespace facts come from the normalized catalog, with explicit identity
 * continuity options applied during the mapping step. Strict mode fails on mapping errors; lossy
 * mode may omit recoverable facts and marks successful output accordingly.
 */
export function mapCatalogToSnapshot(
  catalog: IntrospectionCatalog,
  options?: IntrospectionOptions,
): IntrospectionResult {
  return mapCatalogToCompleteSnapshot(catalog, options)
}
