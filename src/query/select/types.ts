import type {
  NullableSourcesOf,
  QueryCardinality,
  RequiresOf,
} from '../../core/fragment.ts'
import type { DistinctClause } from '../clauses/distinct.ts'
import type { FetchClause } from '../clauses/pagination.ts'
import type { Source, SourceIdentity } from '../../schema/source.ts'
import type { JoinClause } from '../clauses/joins.ts'
import type { AnySelectClause } from '../clauses/types.ts'
import type { FromClause } from '../clauses/from.ts'
import type { OrderByClause } from '../clauses/order-by.ts'
import type { WithClause } from '../clauses/with.ts'
import type { SelectionRequires } from '../selection.ts'
import type { Query } from '../types.ts'

export interface SelectQuery<
  TRow extends object = Record<string, unknown>,
  TCardinality extends QueryCardinality = QueryCardinality,
> extends Query<TRow, TCardinality> {
  readonly queryKind: 'select'
}

type ExactlyOneSafeClause = DistinctClause | OrderByClause<any> | WithClause

type AtMostOneClause = FetchClause<0 | 1>

/**
 * SELECT cardinality is intentionally conservative. A literal FETCH/LIMIT
 * bound of zero or one proves an upper bound; an otherwise source-free query
 * has one row unless a known row-reducing clause is present. Predicates and
 * arbitrary clauses do not prove exactness.
 */
export type SelectCardinality<TClauses extends readonly AnySelectClause[]> =
  Extract<TClauses[number], AtMostOneClause> extends never
    ? Exclude<TClauses[number], ExactlyOneSafeClause> extends never
      ? 'exactly-one'
      : 'many'
    : 'zero-or-one'

export type ClauseScope<TClause> =
  TClause extends FromClause<infer TSources>
    ? TSources[number] extends Source<any, any>
      ? SourceIdentity<TSources[number]>
      : never
    : TClause extends JoinClause<infer TSource, any>
      ? SourceIdentity<TSource>
      : never

export type AvailableScope<TClauses extends readonly AnySelectClause[]> =
  ClauseScope<TClauses[number]>

export type NullableSources<TClauses extends readonly AnySelectClause[]> =
  NullableSourcesOf<TClauses[number]>

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
