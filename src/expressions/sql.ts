import {
  type AnyFragment,
  type DependenciesOf,
  type ExpressionMeta,
  type InheritedMetadata,
  isFragment,
  type NullabilityOf,
  type ResultMeta,
  type SubqueryMeta,
} from "../core/fragment.ts"
import type { AnySqlType, SqlUnknown } from "../core/sql-types.ts"
import type { AnyQuery } from "../query/types.ts"
import { makeExpression, type Expression } from "./types.ts"

type SqlChild<TValues extends readonly unknown[]> = Extract<TValues[number], AnyFragment>

type EmbeddedQueryMetadata<TChild> = TChild extends AnyQuery ? SubqueryMeta : never

/**
 * A parameterized SQL template that composes with Qubu expressions and queries through the normal
 * renderer.
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
  "sql"
> & {
  /**
   * Declare the application output and optionally the SQL semantic domain. Omitting the domain
   * preserves its current declaration. This changes only type metadata: rendering, interpolation
   * metadata, and nullable-source tracking remain unchanged. No SQL cast or decoder is applied.
   */
  $type<TNextOutput, TNextSqlType extends AnySqlType = TSqlType>(): SqlFragment<
    TNextOutput,
    TNextSqlType,
    TChild
  >
}

/** Public call contract for {@link sql}. */
export interface SqlTag {
  <const TValues extends readonly unknown[]>(
    strings: TemplateStringsArray,
    ...values: TValues
  ): SqlFragment<unknown, SqlUnknown, SqlChild<TValues>>
}

function sqlTemplate<
  TOutput,
  TSqlType extends AnySqlType,
  const TValues extends readonly unknown[],
>(
  strings: TemplateStringsArray,
  values: TValues,
): SqlFragment<TOutput, TSqlType, SqlChild<TValues>> {
  const expression = makeExpression("sql", (context) => {
    strings.forEach((text, index) => {
      context.append(text)
      if (index >= values.length) {
        return
      }

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
  })

  const result = Object.freeze({
    ...expression,
    $type: () => result,
  }) as SqlFragment<TOutput, TSqlType, SqlChild<TValues>>

  return result
}

/**
 * Build trusted SQL syntax while binding every ordinary substitution as a parameter. Qubu fragments
 * remain composable substitutions.
 *
 * @remarks
 *   Template text is trusted and is not parsed. Use `identifier()` from `qubu/core` for runtime
 *   identifiers and `unsafeExpression()` for deliberately dynamic syntax. Use `.$type<Output,
 *   SqlType>()` on the returned fragment when the fragment's result is known.
 */
export const sql: SqlTag = Object.freeze(
  <const TValues extends readonly unknown[]>(strings: TemplateStringsArray, ...values: TValues) =>
    sqlTemplate<unknown, SqlUnknown, TValues>(strings, values),
)

function isQueryFragment(value: AnyFragment): value is AnyQuery {
  return "queryKind" in value && "row" in value
}
