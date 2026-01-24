import { SQL, tokenizeCall } from './core.ts'

/**
 * Internal shorthand for aggregate functions. Assumes the return
 * value is nullable.
 */
/* @__NO_SIDE_EFFECTS__ */
const aggFunc =
  <Args extends SQL.Part[], Out>(name: string) =>
  (...args: Args) =>
    new SQL.AggregateExpression<Out | null>(tokenizeCall(name, ...args), '')

/**
 * Aggregate function that counts the number of rows, or if an
 * expression is provided, counts the number of rows where the
 * expression is `NOT NULL`.
 */
export function count(expr?: SQL.Part) {
  if (expr !== undefined) {
    return new SQL.AggregateExpression<number>(tokenizeCall('count', expr), '')
  }
  return new SQL.AggregateExpression<number>(['count(*)'])
}

export const max = aggFunc<[SQL.Expression<number>], number>('max')
export const min = aggFunc<[SQL.Expression<number>], number>('min')
export const sum = aggFunc<[SQL.Expression<number>], number>('sum')
export const avg = aggFunc<[SQL.Expression<number>], number>('avg')
export const stddev = aggFunc<[SQL.Expression<number>], number>('stddev')
export const stddev_pop = aggFunc<[SQL.Expression<number>], number>(
  'stddev_pop'
)
export const stddev_samp = aggFunc<[SQL.Expression<number>], number>(
  'stddev_samp'
)
export const variance = aggFunc<[SQL.Expression<number>], number>('variance')
export const variance_pop = aggFunc<[SQL.Expression<number>], number>(
  'variance_pop'
)
export const variance_samp = aggFunc<[SQL.Expression<number>], number>(
  'variance_samp'
)
export const var_pop = variance_pop
export const var_samp = variance_samp

/**
 * Statistical aggregates
 */
export const corr = aggFunc<
  [SQL.Expression<number>, SQL.Expression<number>],
  number
>('corr')
export const covar_pop = aggFunc<
  [SQL.Expression<number>, SQL.Expression<number>],
  number
>('covar_pop')
export const covar_samp = aggFunc<
  [SQL.Expression<number>, SQL.Expression<number>],
  number
>('covar_samp')
export const regr_avgx = aggFunc<
  [SQL.Expression<number>, SQL.Expression<number>],
  number
>('regr_avgx')
export const regr_avgy = aggFunc<
  [SQL.Expression<number>, SQL.Expression<number>],
  number
>('regr_avgy')
export const regr_count = aggFunc<
  [SQL.Expression<number>, SQL.Expression<number>],
  number
>('regr_count')
export const regr_intercept = aggFunc<
  [SQL.Expression<number>, SQL.Expression<number>],
  number
>('regr_intercept')
export const regr_r2 = aggFunc<
  [SQL.Expression<number>, SQL.Expression<number>],
  number
>('regr_r2')
export const regr_slope = aggFunc<
  [SQL.Expression<number>, SQL.Expression<number>],
  number
>('regr_slope')
export const regr_sxx = aggFunc<
  [SQL.Expression<number>, SQL.Expression<number>],
  number
>('regr_sxx')
export const regr_sxy = aggFunc<
  [SQL.Expression<number>, SQL.Expression<number>],
  number
>('regr_sxy')
export const regr_syy = aggFunc<
  [SQL.Expression<number>, SQL.Expression<number>],
  number
>('regr_syy')

/**
 * String and array aggregates
 */
export const string_agg = aggFunc<
  [SQL.Expression<string>, SQL.Part],
  string
>('string_agg')

export function array_agg<T>(expr: SQL.Expression<T>) {
  return new SQL.AggregateExpression<(T | null)[] | null>(
    tokenizeCall('array_agg', expr),
    ''
  )
}

/**
 * Boolean aggregates
 */
export const bool_and = aggFunc<[SQL.Expression<boolean>], boolean>('bool_and')
export const bool_or = aggFunc<[SQL.Expression<boolean>], boolean>('bool_or')
export const every = aggFunc<[SQL.Expression<boolean>], boolean>('every')

/**
 * JSON aggregates
 */
export const json_agg = aggFunc<[SQL.Part], unknown>('json_agg')
export const json_object_agg = aggFunc<
  [SQL.Part, SQL.Part],
  Record<string, unknown>
>('json_object_agg')
export const jsonb_agg = aggFunc<[SQL.Part], unknown>('jsonb_agg')
export const jsonb_object_agg = aggFunc<
  [SQL.Part, SQL.Part],
  Record<string, unknown>
>('jsonb_object_agg')

/**
 * Ordered-set aggregates
 */
export const percentile_cont = aggFunc<
  [SQL.Expression<number> | number],
  number
>('percentile_cont')
export const percentile_disc = aggFunc<
  [SQL.Expression<number> | number],
  number
>('percentile_disc')
export const mode = aggFunc<[], unknown>('mode')

/**
 * Binary aggregates
 */
export const bit_and = aggFunc<[SQL.Expression<number>], number>('bit_and')
export const bit_or = aggFunc<[SQL.Expression<number>], number>('bit_or')
export const bit_xor = aggFunc<[SQL.Expression<number>], number>('bit_xor')

/**
 * XML aggregates
 */
export const xmlagg = aggFunc<[SQL.Expression<string>], string>('xmlagg')
