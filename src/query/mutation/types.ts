import type {
  CapabilityMetadataOf,
  Fragment,
  RenderFunction,
  RequiresOf,
} from '../../core/fragment.ts'
import type { Query, QueryConfig } from '../types.ts'
import type { SourceIdentity } from '../../schema/source.ts'
import type { WhereClause } from '../clauses/where.ts'
import type {
  ReturningClause,
  ReturningRow,
  ReturningSqlTypes,
} from './returning.ts'
import type { UnknownSourceSqlTypes } from '../../schema/source.ts'
import type { QueryTypeValidation } from '../errors.ts'
import { queryValidationError } from '../errors.ts'
import type { ResultShape } from '../../result.ts'

export type MutationKind = 'insert' | 'update' | 'delete'

export interface MutationQueryConfig extends Omit<QueryConfig, 'cardinality'> {
  readonly kind?: MutationKind
}

type MutationConfigValue<
  TConfig,
  TKey extends PropertyKey,
  TFallback,
> = TKey extends keyof TConfig ? TConfig[TKey] : TFallback

type MutationConfigRow<TConfig> = Extract<
  MutationConfigValue<TConfig, 'row', Record<string, unknown>>,
  object
>
type MutationConfigKind<TConfig> = Extract<
  MutationConfigValue<TConfig, 'kind', MutationKind>,
  MutationKind
>

export interface MutationQuery<TConfig extends MutationQueryConfig = {}>
  extends Query<{
    readonly row: MutationConfigRow<TConfig>
    readonly cardinality: 'many'
    readonly metadata: MutationConfigValue<TConfig, 'metadata', never>
    readonly sqlTypes: MutationConfigValue<
      TConfig,
      'sqlTypes',
      UnknownSourceSqlTypes<MutationConfigRow<TConfig>>
    >
  }> {
  readonly queryKind: MutationConfigKind<TConfig>
}

export type AnyMutationQuery = MutationQuery<any>

export function createMutation<
  TKind extends MutationKind,
  TRow extends object,
  TMetadata = never,
  TSqlTypes = UnknownSourceSqlTypes<TRow>,
>(
  queryKind: TKind,
  row: TRow,
  resultShape: ResultShape,
  render: RenderFunction
): MutationQuery<{
  readonly row: TRow
  readonly kind: TKind
  readonly metadata: TMetadata
  readonly sqlTypes: TSqlTypes
}> {
  return {
    queryKind,
    row,
    resultShape,
    render,
  } as MutationQuery<{
    readonly row: TRow
    readonly kind: TKind
    readonly metadata: TMetadata
    readonly sqlTypes: TSqlTypes
  }>
}

export type MutationCapabilityMetadata<T> = CapabilityMetadataOf<T>

export interface AllowAllClause extends Fragment<never> {
  readonly clauseKind: 'allow-all'
}

export function allowAll(): AllowAllClause {
  return Object.freeze({
    clauseKind: 'allow-all' as const,
    render: () => undefined,
  })
}

export type MutationConditionClause = WhereClause<any>
export type MutationClause =
  | MutationConditionClause
  | AllowAllClause
  | MutationReturningClause

export type MutationSafetyValidation<TClauses extends readonly unknown[]> =
  Extract<
    TClauses[number],
    MutationConditionClause | AllowAllClause
  > extends never
    ? QueryTypeValidation<
        'unsafe-mutation',
        'mutation.safety',
        'Add where(...) or allowAll() explicitly.'
      >
    : unknown

export function validateMutationClauses(
  kind: 'UPDATE' | 'DELETE',
  clauses: readonly MutationClause[]
) {
  let whereSeen = false
  let returningSeen = false
  let allowAllSeen = false

  for (const clause of clauses) {
    if (clause.clauseKind === 'where') {
      if (whereSeen) {
        throw queryValidationError({
          code: 'duplicate-clause',
          context: `mutation.${kind.toLowerCase()}.clauses`,
          path: ['clauses', 'where'],
          message: `${kind} accepts only one WHERE clause`,
          hint: 'Compose repeated conditions with and() or or().',
        })
      }
      whereSeen = true
    } else if (clause.clauseKind === 'returning') {
      if (returningSeen) {
        throw queryValidationError({
          code: 'duplicate-clause',
          context: `mutation.${kind.toLowerCase()}.clauses`,
          path: ['clauses', 'returning'],
          message: `${kind} accepts only one RETURNING clause`,
          hint: 'Use one returning() clause containing the complete projection.',
        })
      }
      returningSeen = true
    } else if (clause.clauseKind === 'allow-all') {
      if (allowAllSeen) {
        throw queryValidationError({
          code: 'duplicate-clause',
          context: `mutation.${kind.toLowerCase()}.clauses`,
          path: ['clauses', 'allowAll'],
          message: `${kind} accepts only one allowAll() marker`,
          hint: 'Keep one allowAll() marker when the mutation is intentionally unrestricted.',
        })
      }
      allowAllSeen = true
    }
  }

  if (!whereSeen && !allowAllSeen) {
    throw queryValidationError({
      code: 'unsafe-mutation',
      context: `mutation.${kind.toLowerCase()}.safety`,
      path: ['clauses'],
      message: `${kind} requires a WHERE clause; use allowAll() to opt into an unrestricted mutation`,
      hint: 'Add where(...) to target rows, or add allowAll() to make the unrestricted intent explicit.',
    })
  }
}

export type MutationReturningClause = ReturningClause<any>

export type MutationReturning<TClauses extends readonly unknown[]> = Extract<
  TClauses[number],
  MutationReturningClause
>

export type MutationRow<TClauses extends readonly unknown[]> = ReturningRow<
  MutationReturning<TClauses>
>

export type MutationSqlTypes<TClauses extends readonly unknown[]> =
  ReturningSqlTypes<MutationReturning<TClauses>>

export type MutationScopeValidation<
  TSource,
  TClauses extends readonly unknown[],
> = [Exclude<RequiresOf<TClauses[number]>, SourceIdentity<TSource>>] extends [
  never,
]
  ? unknown
  : QueryTypeValidation<
      'missing-source',
      'mutation.scope',
      'Use clauses that reference the mutation table or an explicitly correlated source.',
      Exclude<RequiresOf<TClauses[number]>, SourceIdentity<TSource>>
    >

export function hasReturningClause(
  clauses: readonly unknown[]
): clauses is readonly [MutationReturningClause, ...MutationReturningClause[]] {
  return clauses.some(
    clause =>
      typeof clause === 'object' &&
      clause !== null &&
      'clauseKind' in clause &&
      clause.clauseKind === 'returning'
  )
}
