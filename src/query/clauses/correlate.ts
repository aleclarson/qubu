import { type ProvidesOuterSourceMeta, type RenderContext } from "../../core/fragment.ts"
import { type AnySource, type SourceIdentity } from "../../schema/source.ts"
import { createClause, type SelectClause } from "./types.ts"

/**
 * Provision an enclosing source to a correlated SELECT. The clause emits no SQL; select() consumes
 * the provision and records any actually used source as a requirement on the resulting query.
 */
export interface CorrelateClause<
  TSources extends readonly AnySource[] = readonly AnySource[],
> extends SelectClause<ProvidesOuterSourceMeta<SourceIdentity<TSources[number]>>> {
  readonly clauseKind: "correlate"
  readonly sources: TSources
}

export function correlate<const TSources extends readonly [AnySource, ...AnySource[]]>(
  ...sources: TSources
): CorrelateClause<TSources> {
  return Object.assign(
    createClause<ProvidesOuterSourceMeta<SourceIdentity<TSources[number]>>>(
      "correlate",
      "before-select",
      0,
      (_context: RenderContext) => {
        // Correlation is a type-level provision. The enclosing query supplies
        // the actual source when it consumes this query as a subquery.
      },
    ),
    {
      clauseKind: "correlate" as const,
      sources,
    },
  ) as CorrelateClause<TSources>
}
