import type {
  HasAggregate,
  HasSubquery,
  HasWindow,
  OutputOf,
} from '../core/fragment.ts'
import type { ColumnReference } from '../expressions/column.ts'
import type { AnyExpression } from '../expressions/types.ts'
import type { OrderTerm } from '../query/clauses/order-by.ts'

export type IndexTerm = AnyExpression | OrderTerm<any>

export interface IndexOptions<
  TPredicate extends AnyExpression | undefined = AnyExpression | undefined,
> {
  readonly unique?: boolean
  readonly where?: TPredicate
}

type IndexTermExpression<TTerm> =
  TTerm extends OrderTerm<any> ? TTerm['expression'] : TTerm

type IsEligibleColumn<TTerm> =
  IndexTermExpression<TTerm> extends infer TExpression
    ? TExpression extends ColumnReference<string, any>
      ? null extends OutputOf<TExpression>
        ? false
        : true
      : false
    : false

type AllEligibleColumns<TTerms extends readonly IndexTerm[]> = {
  [K in keyof TTerms]: IsEligibleColumn<TTerms[K]>
}[number] extends infer TEligibility
  ? false extends TEligibility
    ? true extends TEligibility
      ? boolean
      : false
    : true
  : false

type BooleanOption<TValue> = [Extract<TValue, true>] extends [never]
  ? false
  : [Exclude<TValue, true>] extends [never]
    ? true
    : boolean

type UniqueOption<TOptions> = 'unique' extends keyof TOptions
  ? BooleanOption<TOptions['unique']>
  : false

type PredicateOption<TOptions> = 'where' extends keyof TOptions
  ? TOptions['where']
  : undefined

type PredicatePresence<TOptions> = [
  Exclude<PredicateOption<TOptions>, undefined>,
] extends [never]
  ? false
  : undefined extends PredicateOption<TOptions>
    ? boolean
    : true

type IsCandidateKey<
  TTerms extends readonly IndexTerm[],
  TOptions extends IndexOptions<any>,
> =
  UniqueOption<TOptions> extends infer TUnique
    ? PredicatePresence<TOptions> extends infer THasPredicate
      ? AllEligibleColumns<TTerms> extends infer TEligible
        ? TUnique extends false
          ? false
          : THasPredicate extends true
            ? false
            : TEligible extends false
              ? false
              : TUnique extends true
                ? THasPredicate extends false
                  ? TEligible extends true
                    ? true
                    : boolean
                  : boolean
                : boolean
        : false
      : false
    : false

/** Portable index metadata retained by a table and its aliases. */
export interface TableIndex<
  TTerms extends readonly IndexTerm[] = any,
  TOptions extends IndexOptions<any> = any,
> {
  readonly kind: 'index'
  readonly terms: TTerms
  readonly unique: UniqueOption<TOptions>
  readonly predicate: PredicateOption<TOptions>
  readonly candidateKey: IsCandidateKey<TTerms, TOptions>
}

/** The widened index shape accepted by source metadata records. */
export interface SourceIndex {
  readonly kind: 'index'
  readonly terms: readonly IndexTerm[]
  readonly unique: boolean
  readonly predicate: AnyExpression | undefined
  readonly candidateKey: boolean
}

export type SourceIndexesRecord = Readonly<Record<string, SourceIndex>>

type ValidIndexExpression<T> = T extends AnyExpression
  ? HasAggregate<T> extends true
    ? never
    : HasWindow<T> extends true
      ? never
      : HasSubquery<T> extends true
        ? never
        : unknown
  : never

type InvalidIndexTerms<TTerms extends readonly IndexTerm[]> = {
  [K in keyof TTerms]: TTerms[K] extends OrderTerm<any>
    ? TTerms[K] extends { readonly nulls: 'FIRST' | 'LAST' }
      ? TTerms[K]
      : ValidIndexExpression<TTerms[K]['expression']> extends never
        ? TTerms[K]
        : never
    : ValidIndexExpression<TTerms[K]> extends never
      ? TTerms[K]
      : never
}[number]

type IndexTermsValidation<TTerms extends readonly IndexTerm[]> = [
  InvalidIndexTerms<TTerms>,
] extends [never]
  ? unknown
  : never

/** Declare a portable column or expression index. */
export function index<
  const TTerms extends readonly [IndexTerm, ...IndexTerm[]],
  const TOptions extends IndexOptions<any> = {},
>(
  terms: TTerms & IndexTermsValidation<NoInfer<TTerms>>,
  options?: TOptions
): TableIndex<TTerms, TOptions> {
  const resolvedOptions = options ?? ({} as TOptions)
  const candidateKey =
    resolvedOptions.unique === true &&
    resolvedOptions.where === undefined &&
    terms.every(term => {
      const expression = 'orderKind' in term ? term.expression : term
      return expression.expressionKind === 'column'
    })
  return Object.freeze({
    kind: 'index',
    terms,
    unique: resolvedOptions.unique === true,
    predicate: resolvedOptions.where,
    candidateKey,
  }) as unknown as TableIndex<TTerms, TOptions>
}
