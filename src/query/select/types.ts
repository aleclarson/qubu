import type {
  GroupingDependenciesOf,
  GroupingKeysOf,
  HasAggregate,
  NullableSourcesOf,
  ProvidesOuterOf,
  QueryCardinality,
  RequiresOuterOf,
  RequiresOf,
} from '../../core/fragment.ts'
import type { DistinctClause } from '../clauses/distinct.ts'
import type { AnyPaginationClause, FetchClause } from '../clauses/pagination.ts'
import type { GroupByClause } from '../clauses/group-by.ts'
import type { HavingClause } from '../clauses/having.ts'
import type { ProvidedSourceIdentity } from '../../schema/source.ts'
import type { JoinClause } from '../clauses/joins.ts'
import type { AnySelectClause } from '../clauses/types.ts'
import type { FromClause, FromScope } from '../clauses/from.ts'
import type { OrderByClause } from '../clauses/order-by.ts'
import type { WithClause } from '../clauses/with.ts'
import type { SelectionItems, SelectionRequires } from '../selection.ts'
import type { VisibleDependenciesOf } from '../../core/fragment.ts'
import type { Query } from '../types.ts'
import type { Omit, SelectPart } from '../omit.ts'
import type { UnknownSourceSqlTypes } from '../../schema/source.ts'

export interface SelectQuery<
  TRow extends object = Record<string, unknown>,
  TCardinality extends QueryCardinality = QueryCardinality,
  TMetadata = never,
  TSqlTypes = UnknownSourceSqlTypes<TRow>,
> extends Query<TRow, TCardinality, TMetadata, TSqlTypes> {
  readonly queryKind: 'select'
}

type ExactlyOneSafeClause = DistinctClause | OrderByClause<any> | WithClause

type AtMostOneClause = FetchClause<0 | 1>

type UnconditionalAtMostOneClause<TParts extends readonly SelectPart[]> = {
  [TIndex in keyof TParts]: Omit extends TParts[TIndex]
    ? never
    : Extract<TParts[TIndex], AtMostOneClause>
}[number]

type ConditionalPaginationClause<TParts extends readonly SelectPart[]> = {
  [TIndex in keyof TParts]: Omit extends TParts[TIndex]
    ? Extract<TParts[TIndex], AnyPaginationClause>
    : never
}[number]

/**
 * SELECT cardinality is intentionally conservative. A literal FETCH/LIMIT
 * bound of zero or one proves an upper bound only when it is unconditional;
 * an otherwise source-free query has one row unless a known row-reducing
 * clause is present. Conditional pagination, predicates, and arbitrary clauses
 * do not prove exactness.
 */
export type SelectCardinality<TParts extends readonly SelectPart[]> =
  UnconditionalAtMostOneClause<TParts> extends never
    ? ConditionalPaginationClause<TParts> extends never
      ? Exclude<TParts[number], ExactlyOneSafeClause | Omit> extends never
        ? 'exactly-one'
        : 'many'
      : 'many'
    : 'zero-or-one'

export type ClauseScope<TClause> = TClause extends FromClause
  ? FromScope<TClause>
  : TClause extends JoinClause<infer TSource, any>
    ? ProvidedSourceIdentity<TSource>
    : never

export type AvailableScope<TClauses extends readonly AnySelectClause[]> =
  ClauseScope<TClauses[number]>

export type AvailableOuterScope<TClauses extends readonly AnySelectClause[]> =
  ProvidesOuterOf<TClauses[number]>

export type NullableSources<TClauses extends readonly AnySelectClause[]> =
  NullableSourcesOf<TClauses[number]>

export type RequiredScope<
  TSelection,
  TClauses extends readonly AnySelectClause[],
> =
  | SelectionRequires<TSelection>
  | RequiresOuterOf<SelectionItems<TSelection>>
  | RequiresOf<TClauses[number]>
  | RequiresOuterOf<TClauses[number]>

export type MissingScope<
  TSelection,
  TClauses extends readonly AnySelectClause[],
> = Exclude<
  RequiredScope<TSelection, TClauses>,
  AvailableScope<TClauses> | AvailableOuterScope<TClauses>
>

export type RequiredOuterScope<
  TSelection,
  TClauses extends readonly AnySelectClause[],
> = Extract<
  Exclude<RequiredScope<TSelection, TClauses>, AvailableScope<TClauses>>,
  AvailableOuterScope<TClauses>
>

export type ScopeValidation<
  TSelection,
  TClauses extends readonly AnySelectClause[],
> = [MissingScope<TSelection, TClauses>] extends [never]
  ? unknown
  : {
      readonly __missing_sources__: MissingScope<TSelection, TClauses>
    }

type GroupingRuleClause = HavingClause<any> | OrderByClause<any>

type HasGroupByClause<TClauses extends readonly AnySelectClause[]> =
  Extract<TClauses[number], GroupByClause<any>> extends never ? false : true

type HasHavingClause<TClauses extends readonly AnySelectClause[]> =
  Extract<TClauses[number], HavingClause<any>> extends never ? false : true

type GroupingRuleClauses<TClauses extends readonly AnySelectClause[]> = Extract<
  TClauses[number],
  GroupingRuleClause
>

type RequiresGrouping<TSelection, TClauses extends readonly AnySelectClause[]> =
  HasGroupByClause<TClauses> extends true
    ? true
    : HasHavingClause<TClauses> extends true
      ? true
      : HasAggregate<SelectionItems<TSelection> | GroupingRuleClauses<TClauses>>

type GroupingFailure<
  TExpression,
  TClauses extends readonly AnySelectClause[],
> = TExpression extends unknown
  ? [VisibleDependenciesOf<TExpression>] extends [never]
    ? never
    : [
          Exclude<
            VisibleDependenciesOf<TExpression>,
            GroupingDependenciesOf<TClauses[number]>
          >,
        ] extends [never]
      ? never
      : [Extract<TExpression, GroupingKeysOf<TClauses[number]>>] extends [never]
        ? VisibleDependenciesOf<TExpression>
        : never
  : never

type SelectionGroupingFailures<
  TSelection,
  TClauses extends readonly AnySelectClause[],
> = GroupingFailure<SelectionItems<TSelection>, TClauses>

type ClauseGroupingFailures<TClauses extends readonly AnySelectClause[]> =
  TClauses[number] extends infer TClause
    ? TClause extends GroupingRuleClause
      ? GroupingFailure<TClause, TClauses>
      : never
    : never

type GroupByAggregateFailures<TClauses extends readonly AnySelectClause[]> =
  TClauses[number] extends infer TClause
    ? TClause extends GroupByClause<any>
      ? HasAggregate<TClause> extends true
        ? TClause
        : never
      : never
    : never

type GroupingFailures<
  TSelection,
  TClauses extends readonly AnySelectClause[],
> =
  | SelectionGroupingFailures<TSelection, TClauses>
  | ClauseGroupingFailures<TClauses>
  | GroupByAggregateFailures<TClauses>

/**
 * Enforce the conservative grouped-query rule: visible column dependencies
 * must be grouped, while aggregate arguments are consumed by the aggregate.
 * Non-column GROUP BY expressions are accepted as exact grouping keys only.
 */
export type GroupingValidation<
  TSelection,
  TClauses extends readonly AnySelectClause[],
> =
  RequiresGrouping<TSelection, TClauses> extends true
    ? [GroupingFailures<TSelection, TClauses>] extends [never]
      ? unknown
      : {
          readonly __invalid_grouping__: GroupingFailures<TSelection, TClauses>
        }
    : unknown
