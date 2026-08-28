import {
  type CapabilityMetadataOf,
  type RequiresOuterMetadataOf,
} from '../../core/fragment.ts'
import { createClause, type SelectClause } from './types.ts'
import type {
  AnySource,
  ProvidedSourceIdentity,
  Source,
  SourceProvision,
} from '../../schema/source.ts'

export interface FromClause<
  TSources extends readonly AnySource[] = readonly AnySource[],
  TMetadata =
    | RequiresOuterMetadataOf<TSources[number]>
    | CapabilityMetadataOf<TSources[number]>,
> extends SelectClause<TMetadata> {
  readonly clauseKind: 'from'
  readonly sources: TSources
}

export function from<
  const TSources extends readonly [AnySource, ...AnySource[]],
>(
  ...sources: TSources
): FromClause<
  TSources,
  | RequiresOuterMetadataOf<TSources[number]>
  | CapabilityMetadataOf<TSources[number]>
> {
  return Object.assign(
    createClause('from', 'after-select', 30, context => {
      context.append('FROM ')
      sources.forEach((source, index) => {
        if (index > 0) context.append(', ')
        context.render(source)
      })
    }),
    { clauseKind: 'from' as const, sources }
  ) as FromClause<
    TSources,
    | RequiresOuterMetadataOf<TSources[number]>
    | CapabilityMetadataOf<TSources[number]>
  >
}

export type FromSource<T> =
  T extends FromClause<infer TSources>
    ? TSources[number] extends infer TSource
      ? TSource extends Source<any>
        ? [SourceProvision<TSource>] extends [never]
          ? never
          : TSource
        : never
      : never
    : never

export type FromScope<T> =
  T extends FromClause<infer TSources>
    ? ProvidedSourceIdentity<TSources[number]>
    : never
