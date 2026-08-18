import type {
  CapabilityMetadataOf,
  Fragment,
  RenderFunction,
  RequiresOf,
} from '../../core/fragment.ts'
import type { Query } from '../types.ts'
import type { SourceIdentity } from '../../schema/source.ts'
import type { WhereClause } from '../clauses/where.ts'
import type { ReturningClause, ReturningRow } from './returning.ts'

export type MutationKind = 'insert' | 'update' | 'delete'

export interface MutationQuery<
  TRow extends object = Record<string, unknown>,
  TKind extends MutationKind = MutationKind,
  TMetadata = never,
> extends Query<TRow, 'many', TMetadata> {
  readonly queryKind: TKind
}

export type AnyMutationQuery = MutationQuery<any, any>

export function createMutation<
  TKind extends MutationKind,
  TRow extends object,
  TMetadata = never,
>(
  queryKind: TKind,
  row: TRow,
  render: RenderFunction
): MutationQuery<TRow, TKind, TMetadata> {
  return {
    queryKind,
    row,
    render,
  } as MutationQuery<TRow, TKind, TMetadata>
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

export const allowUnrestricted = allowAll
export const unsafeMutation = allowAll

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
    ? {
        readonly __requires_where_or_allowAll__: never
      }
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
      if (whereSeen) throw new Error(`${kind} accepts only one WHERE clause`)
      whereSeen = true
    } else if (clause.clauseKind === 'returning') {
      if (returningSeen) {
        throw new Error(`${kind} accepts only one RETURNING clause`)
      }
      returningSeen = true
    } else if (clause.clauseKind === 'allow-all') {
      if (allowAllSeen) {
        throw new Error(`${kind} accepts only one allowAll() marker`)
      }
      allowAllSeen = true
    }
  }

  if (!whereSeen && !allowAllSeen) {
    throw new Error(
      `${kind} requires a WHERE clause; use allowAll() to opt into an unrestricted mutation`
    )
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

export type MutationScopeValidation<
  TSource,
  TClauses extends readonly unknown[],
> = [Exclude<RequiresOf<TClauses[number]>, SourceIdentity<TSource>>] extends [
  never,
]
  ? unknown
  : {
      readonly __missing_sources__: Exclude<
        RequiresOf<TClauses[number]>,
        SourceIdentity<TSource>
      >
    }

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
