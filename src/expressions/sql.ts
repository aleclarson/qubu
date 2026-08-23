import {
  type AnyFragment,
  type DependenciesOf,
  type ExpressionMeta,
  type InheritedMetadata,
  isFragment,
  type NullabilityOf,
  type ResultMeta,
  type SubqueryMeta,
} from '../core/fragment.ts'
import type { AnySqlType, SqlUnknown } from '../core/sql-types.ts'
import type { AnyQuery } from '../query/types.ts'
import { makeExpression, type Expression } from './types.ts'

type SqlChild<TValues extends readonly unknown[]> = Extract<
  TValues[number],
  AnyFragment
>

type EmbeddedQueryMetadata<TChild> = TChild extends AnyQuery
  ? SubqueryMeta
  : never

/**
 * A parameterized SQL template that composes with Qubu expressions and
 * queries through the normal renderer.
 */
export type SqlFragment<
  TOutput = unknown,
  TSqlType extends AnySqlType = SqlUnknown,
  TChild extends AnyFragment = never,
> = Expression<
  | ResultMeta<TOutput, NullabilityOf<TChild>, TSqlType>
  | ExpressionMeta<DependenciesOf<TChild>>
  | InheritedMetadata<TChild>
  | EmbeddedQueryMetadata<TChild>,
  'sql'
>

/** A SQL template tag with an explicitly declared output and SQL domain. */
export interface TypedSqlTag<
  TOutput,
  TSqlType extends AnySqlType = SqlUnknown,
> {
  <const TValues extends readonly unknown[]>(
    strings: TemplateStringsArray,
    ...values: TValues
  ): SqlFragment<TOutput, TSqlType, SqlChild<TValues>>
}

/** Public call contract for {@link sql}. */
export interface SqlTag extends TypedSqlTag<unknown, SqlUnknown> {
  /**
   * Declare the application output and SQL semantic domain without changing
   * how template substitutions render.
   */
  type<TOutput, TSqlType extends AnySqlType = SqlUnknown>(): TypedSqlTag<
    TOutput,
    TSqlType
  >
}

function sqlTemplate<
  TOutput,
  TSqlType extends AnySqlType,
  const TValues extends readonly unknown[],
>(
  strings: TemplateStringsArray,
  values: TValues
): SqlFragment<TOutput, TSqlType, SqlChild<TValues>> {
  return makeExpression('sql', context => {
    strings.forEach((text, index) => {
      context.append(text)
      if (index >= values.length) return

      const value = values[index]
      if (!isFragment(value)) {
        context.parameter(value)
        return
      }

      if (isQueryFragment(value)) {
        context.renderRelation(value)
      } else {
        context.render(value)
      }
    })
  }) as SqlFragment<TOutput, TSqlType, SqlChild<TValues>>
}

function createSqlTag<TOutput, TSqlType extends AnySqlType>(): TypedSqlTag<
  TOutput,
  TSqlType
> {
  return <const TValues extends readonly unknown[]>(
    strings: TemplateStringsArray,
    ...values: TValues
  ) => sqlTemplate<TOutput, TSqlType, TValues>(strings, values)
}

const sqlTag = createSqlTag<unknown, SqlUnknown>() as SqlTag
sqlTag.type = createSqlTag

/**
 * Build trusted SQL syntax while binding every ordinary substitution as a
 * parameter. Qubu fragments remain composable substitutions.
 *
 * @remarks Template text is trusted and is not parsed. Use `identifier()` from
 * `qubu/core` for runtime identifiers and `unsafeExpression()` for deliberately
 * dynamic syntax. Use `sql.type<Output, SqlType>()` when the fragment's result
 * is known.
 */
export const sql: SqlTag = Object.freeze(sqlTag)

function isQueryFragment(value: AnyFragment): value is AnyQuery {
  return 'queryKind' in value && 'row' in value
}
