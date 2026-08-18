import { createClause, type SelectClause } from './types.ts'
import type { AnySource, Source } from '../../schema/source.ts'

export interface FromClause<
  TSources extends readonly AnySource[] = readonly AnySource[],
> extends SelectClause<never> {
  readonly clauseKind: 'from'
  readonly sources: TSources
}

export function from<
  const TSources extends readonly [AnySource, ...AnySource[]],
>(...sources: TSources): FromClause<TSources> {
  return Object.assign(
    createClause('from', 'after-select', 30, context => {
      context.append('FROM ')
      sources.forEach((source, index) => {
        if (index > 0) context.append(', ')
        context.render(source)
      })
    }),
    { clauseKind: 'from' as const, sources }
  ) as FromClause<TSources>
}

export type FromSource<T> =
  T extends FromClause<infer TSources>
    ? TSources[number] extends Source<any, any>
      ? TSources[number]
      : never
    : never
