import type { Expression, SourceIdentity } from "qubu"
import { assertDialectCapability, makeExpression, resultValue } from "qubu/core"
import type {
  RequiresCapabilityMeta,
  RequiresSourceMeta,
  RenderContext,
  ResultMeta,
  AnySqlType,
} from "qubu/core"
import type { SqlBoolean, SqlDecimal, SqlText } from "qubu/core"

import { fts5Capability, type Fts5Source } from "./table.ts"

type Fts5ExpressionMetadata<TSource, TOutput, TSqlType extends AnySqlType> =
  | ResultMeta<TOutput, never, TSqlType>
  | RequiresSourceMeta<SourceIdentity<TSource>>
  | RequiresCapabilityMeta<typeof fts5Capability>

export type Fts5MatchExpression<TSource extends Fts5Source = Fts5Source> = Expression<
  Fts5ExpressionMetadata<TSource, boolean, SqlBoolean>,
  "operator"
>

export type Fts5RankExpression<TSource extends Fts5Source = Fts5Source> = Expression<
  Fts5ExpressionMetadata<TSource, number, SqlDecimal>,
  "function"
>

export type Fts5TextExpression<TSource extends Fts5Source = Fts5Source> = Expression<
  Fts5ExpressionMetadata<TSource, string | null, SqlText>,
  "function"
>

/** Match an FTS5 table against a bound query string. */
export function match<TName extends string, TColumns extends object>(
  source: Fts5Source<TName, TColumns>,
  query: string,
): Fts5MatchExpression<Fts5Source<TName, TColumns>> {
  if (typeof query !== "string") {
    throw new TypeError("FTS5 MATCH queries must be strings")
  }

  return makeExpression<
    Fts5ExpressionMetadata<Fts5Source<TName, TColumns>, boolean, SqlBoolean>,
    "operator"
  >(
    "operator",
    (context) => {
      assertDialectCapability(context.dialect, fts5Capability)
      context.append("(")
      context.render(source.reference)
      context.append(" MATCH ")
      context.parameter(query, "text")
      context.append(")")
    },
    undefined,
    resultValue("boolean", undefined, "boolean"),
  ) as Fts5MatchExpression<Fts5Source<TName, TColumns>>
}

/** Return SQLite FTS5's lower-is-better BM25 rank for a result row. */
export function bm25<TName extends string, TColumns extends object>(
  source: Fts5Source<TName, TColumns>,
  weights: readonly number[] = [],
): Fts5RankExpression<Fts5Source<TName, TColumns>> {
  for (const weight of weights) {
    if (!Number.isFinite(weight) || weight < 0) {
      throw new TypeError("FTS5 BM25 weights must be finite, non-negative numbers")
    }
  }

  return makeExpression<
    Fts5ExpressionMetadata<Fts5Source<TName, TColumns>, number, SqlDecimal>,
    "function"
  >(
    "function",
    (context) => {
      assertDialectCapability(context.dialect, fts5Capability)
      context.append("bm25(")
      context.render(source.reference)
      for (const weight of weights) {
        context.append(", ")
        context.parameter(weight, "decimal")
      }

      context.append(")")
    },
    undefined,
    resultValue(undefined, undefined, "decimal"),
  ) as Fts5RankExpression<Fts5Source<TName, TColumns>>
}

/** Highlight one indexed column using FTS5's auxiliary function. */
export function highlight<TName extends string, TColumns extends object>(
  source: Fts5Source<TName, TColumns>,
  column: keyof TColumns & string,
  start: string,
  end: string,
): Fts5TextExpression<Fts5Source<TName, TColumns>> {
  const index = columnIndex(source, column)

  return makeTextFunction(source, "highlight", (context) => {
    context.append(`, ${index}, `)
    context.parameter(start, "text")
    context.append(", ")
    context.parameter(end, "text")
  })
}

/** Extract a bounded FTS5 snippet from one indexed column. */
export function snippet<TName extends string, TColumns extends object>(
  source: Fts5Source<TName, TColumns>,
  column: keyof TColumns & string,
  start: string,
  end: string,
  ellipsis = "…",
  maxTokens = 15,
): Fts5TextExpression<Fts5Source<TName, TColumns>> {
  if (!Number.isInteger(maxTokens) || maxTokens <= 0) {
    throw new TypeError("FTS5 snippet maxTokens must be a positive integer")
  }

  const index = columnIndex(source, column)

  return makeTextFunction(source, "snippet", (context) => {
    context.append(`, ${index}, `)
    context.parameter(start, "text")
    context.append(", ")
    context.parameter(end, "text")
    context.append(", ")
    context.parameter(ellipsis, "text")
    context.append(", ")
    context.parameter(maxTokens, "integer")
  })
}

function makeTextFunction<TSource extends Fts5Source>(
  source: TSource,
  name: "highlight" | "snippet",
  renderArguments: (context: RenderContext) => void,
): Fts5TextExpression<TSource> {
  return makeExpression<Fts5ExpressionMetadata<TSource, string | null, SqlText>, "function">(
    "function",
    (context) => {
      assertDialectCapability(context.dialect, fts5Capability)
      context.append(`${name}(`)
      context.render(source.reference)
      renderArguments(context)
      context.append(")")
    },
    undefined,
    resultValue(undefined, undefined, "text"),
  ) as Fts5TextExpression<TSource>
}

function columnIndex<TSource extends Fts5Source>(source: TSource, column: string): number {
  const index = source.fts5.columns.findIndex((candidate) => candidate.fieldName === column)

  if (index < 0) {
    throw new TypeError(`Unknown FTS5 column "${column}"`)
  }

  return index
}
