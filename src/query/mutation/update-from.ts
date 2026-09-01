import { assertDialectCapability } from "../../core/dialect.ts"
import type {
  CapabilityMetadataOf,
  Fragment,
  RenderContext,
  RequiresCapabilityMeta,
  RequiresOuterMetadataOf,
} from "../../core/fragment.ts"
import type { AnySource, ProvidedSourceIdentity } from "../../schema/source.ts"

/** A PostgreSQL FROM clause that contributes typed sources to an UPDATE scope. */
export interface UpdateFromClause<
  TSources extends readonly AnySource[] = readonly AnySource[],
  TMetadata =
    | RequiresOuterMetadataOf<TSources[number]>
    | CapabilityMetadataOf<TSources[number]>
    | RequiresCapabilityMeta<"update-from">,
> extends Fragment<TMetadata> {
  readonly clauseKind: "update-from"
  readonly sources: TSources
}

/** Introduce one or more PostgreSQL sources to an UPDATE statement. */
export function updateFrom<const TSources extends readonly [AnySource, ...AnySource[]]>(
  ...sources: TSources
): UpdateFromClause<TSources> {
  return Object.freeze({
    clauseKind: "update-from" as const,
    sources,
    render(context: RenderContext) {
      assertDialectCapability(context.dialect, "update-from")
      context.append("FROM ")
      sources.forEach((source, index) => {
        if (index > 0) {
          context.append(", ")
        }

        context.render(source)
      })
    },
  }) as UpdateFromClause<TSources>
}

/** Source identities introduced to an UPDATE by updateFrom(). */
export type UpdateFromScope<T> =
  T extends UpdateFromClause<infer TSources> ? ProvidedSourceIdentity<TSources[number]> : never
