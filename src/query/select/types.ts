import type { ParametersOf, RequiresOf } from '../../core/fragment.ts'
import type { Source, SourceIdentity } from '../../schema/source.ts'
import type { JoinClause } from '../clauses/joins.ts'
import type { AnySelectClause } from '../clauses/types.ts'
import type { FromClause } from '../clauses/from.ts'
import type { SelectionParameters, SelectionRequires } from '../selection.ts'
import type { Query } from '../types.ts'

export interface SelectQuery<
  TRow extends object = Record<string, unknown>,
  TParameters = never,
> extends Query<TRow, TParameters> {
  readonly queryKind: 'select'
}

export type ClauseScope<TClause> =
  TClause extends FromClause<infer TSources>
    ? TSources[number] extends Source<any, any>
      ? SourceIdentity<TSources[number]>
      : never
    : TClause extends JoinClause<infer TSource, any, any>
      ? SourceIdentity<TSource>
      : never

export type AvailableScope<TClauses extends readonly AnySelectClause[]> =
  ClauseScope<TClauses[number]>

export type RequiredScope<
  TSelection,
  TClauses extends readonly AnySelectClause[],
> = SelectionRequires<TSelection> | RequiresOf<TClauses[number]>

export type MissingScope<
  TSelection,
  TClauses extends readonly AnySelectClause[],
> = Exclude<RequiredScope<TSelection, TClauses>, AvailableScope<TClauses>>

export type ScopeValidation<
  TSelection,
  TClauses extends readonly AnySelectClause[],
> = [MissingScope<TSelection, TClauses>] extends [never]
  ? unknown
  : {
      readonly __missing_sources__: MissingScope<TSelection, TClauses>
    }

export type SelectParameters<
  TSelection,
  TClauses extends readonly AnySelectClause[],
> = SelectionParameters<TSelection> | ParametersOf<TClauses[number]>
