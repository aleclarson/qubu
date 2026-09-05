import {
  fragment,
  type CardinalityOf,
  type InheritedMetadata,
  type RenderContext,
  type ResultMeta,
  type SubqueryMeta,
} from "../core/fragment.ts"
import { snakeCaseIdentifier } from "../core/naming.ts"
import type { SqlJson } from "../core/sql-types.ts"
import type { QueryTypeValidation } from "../query/errors.ts"
import type { AnyQuery, QueryRow } from "../query/types.ts"
import {
  bigintResultDecoder,
  booleanResultDecoder,
  dateResultDecoder,
  timestampResultDecoder,
  resultValue,
  type ResultDecodeContext,
  type ResultField,
  type ResultShape,
} from "../result.ts"
import { makeExpression, type Expression } from "./types.ts"

type JsonSourceQuery = AnyQuery & { readonly queryKind: "select" | "set" }

type JsonQueryExpression<TQuery, TOutput> = Expression<
  ResultMeta<TOutput, never, SqlJson<TOutput>> | InheritedMetadata<TQuery> | SubqueryMeta,
  "subquery"
>
type ObjectQueryValidation<TQuery> = 0 extends 1 & CardinalityOf<TQuery>
  ? QueryTypeValidation<
      "invalid-subquery",
      "jsonObjectFrom.query",
      "Prove at most one row with fetchFirst(1)."
    >
  : [CardinalityOf<TQuery>] extends ["exactly-one" | "zero-or-one"]
    ? unknown
    : QueryTypeValidation<
        "invalid-subquery",
        "jsonObjectFrom.query",
        "Prove at most one row with fetchFirst(1)."
      >

/**
 * Turn a SELECT or set query into an inferred array expression; empty queries return [].
 *
 * Preserves correlation, explicit ordering and pagination on PostgreSQL, MySQL 8.0.21+, and SQLite
 * 3.45+. Without ORDER BY, element order is unspecified. DISTINCT ordering must use expressions
 * present in the projection.
 *
 * Nested fields require supported runtime SQL domains. Bigints, binary values and serialized JSON
 * use exact text transport; dates and booleans are normalized without adapter-specific decoders.
 * Unsupported domains or lossy numeric representations throw. Custom result decoders receive the
 * transport value (including strings for bigint, decimal, binary hex and JSON), consistent with
 * their unknown-input contract.
 */
export function jsonArrayFrom<TQuery extends JsonSourceQuery>(
  query: TQuery,
): JsonQueryExpression<TQuery, QueryRow<TQuery>[]> {
  return nestedJson(query, true)
}

/**
 * Turn a query proven to return at most one row into an inferred object.
 *
 * Empty queries return null; exactly-one queries retain a non-null result type. Use an
 * unconditional fetchFirst(1) to prove the row bound for a table query. Shares dialect, projection
 * and exact-decoding rules with {@link jsonArrayFrom}.
 *
 * @throws {TypeError} When the query lacks a runtime at-most-one-row proof.
 */
export function jsonObjectFrom<TQuery extends JsonSourceQuery>(
  query: TQuery & ObjectQueryValidation<TQuery>,
): JsonQueryExpression<
  TQuery,
  QueryRow<TQuery> | ([CardinalityOf<TQuery>] extends ["exactly-one"] ? never : null)
> {
  if (query.cardinality !== "exactly-one" && query.cardinality !== "zero-or-one") {
    throw new TypeError("jsonObjectFrom() requires a query proven to return at most one row")
  }

  return nestedJson(query, false)
}

function nestedJson<TQuery extends AnyQuery, TOutput>(
  query: TQuery,
  array: boolean,
): JsonQueryExpression<TQuery, TOutput> {
  if (query.queryKind !== "select" && query.queryKind !== "set") {
    throw new TypeError("Nested JSON requires a SELECT or set query")
  }

  return makeExpression(
    "subquery",
    (context) => renderNestedJson(context, query, array),
    "subquery",
    resultValue(
      "json",
      (value, context) => {
        const parsed = typeof value === "string" ? parseExactJson(value) : value

        if (array) {
          if (!Array.isArray(parsed)) {
            throw new TypeError("Expected a nested JSON array")
          }

          return parsed.map((row) => decodeNestedRow(row, query.resultShape, context))
        }

        return parsed === null ? null : decodeNestedRow(parsed, query.resultShape, context)
      },
      "json",
    ),
  )
}

function renderNestedJson(context: RenderContext, query: AnyQuery, array: boolean) {
  const dialect = context.dialect.name

  if (dialect !== "postgresql" && dialect !== "sqlite" && dialect !== "mysql") {
    throw new TypeError(`Nested JSON queries are not supported by dialect "${dialect}"`)
  }

  const q = context.dialect.quoteIdentifier
  const names = new Set(query.resultShape.fields.map((field) => snakeCaseIdentifier(field.name)))
  let ordinal = "__qubu_json_order"

  while (names.has(ordinal)) {
    ordinal += "_"
  }

  const ordered = array && query.renderJsonRows !== undefined
  const reference = (name: string) => context.append(`${q("__qubu_json")}.${q(name)}`)
  const renderObject = () => {
    context.append(dialect === "postgresql" ? "json_build_object(" : "json_object(")
    query.resultShape.fields.forEach((field, index) => {
      if (index) {
        context.append(", ")
      }

      context.parameter(field.name, "text")
      if (dialect === "postgresql") {
        context.append("::text")
      }

      context.append(", ")
      const type = field.sqlType ?? field.type
      const ref = () => reference(snakeCaseIdentifier(field.name))

      if (type === "decimal" && dialect === "sqlite") {
        // SQLite's ordinary text cast keeps only 15 significant digits for REAL.
        // The alternate-form printf conversion preserves the stored double exactly.
        context.append("CASE typeof(")
        ref()
        context.append(") WHEN 'real' THEN printf('%!.17g', ")
        ref()
        context.append(") WHEN 'integer' THEN CAST(")
        ref()
        context.append(" AS TEXT) WHEN 'null' THEN NULL ELSE json('invalid numeric storage') END")
      } else if (type === "bigint" || type === "decimal" || type === "json") {
        context.append("CAST(")
        ref()
        context.append(dialect === "mysql" ? " AS CHAR)" : " AS TEXT)")
      } else if (type === "binary") {
        if (dialect === "sqlite") {
          context.append("CASE WHEN ")
          ref()
          context.append(" IS NULL THEN NULL ELSE ")
        }

        context.append(dialect === "postgresql" ? "encode(" : "hex(")
        ref()
        context.append(dialect === "postgresql" ? ", 'hex')" : ")")
        if (dialect === "sqlite") {
          context.append(" END")
        }
      } else if (
        type === undefined ||
        type === "unknown" ||
        !["text", "uuid", "integer", "decimal", "boolean", "date", "timestamp", "json"].includes(
          type,
        )
      ) {
        throw new TypeError(
          `Nested JSON field "${field.name}" requires a supported declared SQL domain`,
        )
      } else {
        ref()
      }
    })
    context.append(")")
  }

  context.append(array ? "COALESCE((SELECT " : "(SELECT ")
  if (array) {
    context.append(
      dialect === "postgresql"
        ? "json_agg("
        : dialect === "sqlite"
          ? "json_group_array("
          : "JSON_ARRAYAGG(",
    )
  }

  renderObject()
  if (array) {
    if (ordered && dialect !== "mysql") {
      context.append(" ORDER BY ")
      reference(ordinal)
    }

    context.append(")")
    if (dialect === "mysql") {
      context.append(" OVER (")
      if (ordered) {
        context.append("ORDER BY ")
        reference(ordinal)
        context.append(" ")
      }

      context.append("ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING)")
    }
  }

  context.append(" FROM (")
  context.renderRelation(
    fragment((inner) => {
      if (ordered) {
        query.renderJsonRows!(inner, ordinal)
      } else {
        inner.render(query)
      }
    }),
  )
  context.append(`) AS ${q("__qubu_json")}`)
  if (array && dialect === "mysql") {
    context.append(" LIMIT 1")
  }

  context.append(")")
  if (array) {
    context.append(
      dialect === "postgresql"
        ? ", '[]'::json)"
        : dialect === "mysql"
          ? ", JSON_ARRAY())"
          : ", json('[]'))",
    )
  }
}

function decodeNestedRow(
  value: unknown,
  shape: ResultShape,
  context: ResultDecodeContext,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Expected a nested JSON object")
  }

  const row = value as Record<string, unknown>
  const entries = shape.fields.map((field) => {
    if (!Object.hasOwn(row, field.name)) {
      throw new TypeError(`Missing nested JSON field "${field.name}"`)
    }

    return [field.name, decodeNestedField(row[field.name], field, context)] as const
  })

  return Object.fromEntries(entries)
}

function decodeNestedField(
  value: unknown,
  field: ResultField,
  context: ResultDecodeContext,
): unknown {
  if (value === null) {
    return null
  }

  if (field.decoder) {
    return field.decoder(value, {
      ...context,
      field: `${context.field}.${field.name}`,
    })
  }

  switch (field.type ?? field.sqlType) {
    case "bigint": {
      return bigintResultDecoder(value, context)
    }

    case "boolean": {
      return booleanResultDecoder(value, context)
    }

    case "date": {
      return dateResultDecoder(value, context)
    }

    case "timestamp": {
      return timestampResultDecoder(value, context)
    }

    case "json": {
      return typeof value === "string" ? parseExactJson(value) : value
    }

    case "binary": {
      if (typeof value !== "string" || !/^(?:[\da-f]{2})*$/iu.test(value)) {
        throw new TypeError("Expected hexadecimal binary result")
      }

      return Uint8Array.from(value.match(/../gu) ?? [], (byte) => parseInt(byte, 16))
    }

    case "integer": {
      if (typeof value !== "number" || !Number.isSafeInteger(value)) {
        throw new TypeError("Expected a safe integer result")
      }

      return value
    }

    case "decimal": {
      if (typeof value !== "string" && typeof value !== "number") {
        throw new TypeError("Expected a numeric result")
      }

      if (context.dialect.name === "sqlite") {
        canonicalDecimal(String(value))
        const number = Number(value)

        if (
          !Number.isFinite(number) ||
          (Number.isInteger(number) && !Number.isSafeInteger(number))
        ) {
          throw new TypeError("Expected a finite, safely represented SQLite number")
        }

        return number
      }

      return exactNumber(String(value))
    }

    case "text":
    case "uuid": {
      if (typeof value !== "string") {
        throw new TypeError("Expected a text result")
      }

      return value
    }

    default: {
      throw new TypeError(`Unsupported nested JSON field "${field.name}"`)
    }
  }
}

// Compare the decimal spelling to Number's shortest round-trippable spelling before conversion.
// Scale-only differences such as 1.000 and 1e0 are harmless; dropped significant digits are not.
function exactNumber(value: string): number {
  const number = Number(value)

  if (!Number.isFinite(number) || canonicalDecimal(value) !== canonicalDecimal(String(number))) {
    throw new TypeError(
      "Nested JSON numeric value cannot be represented exactly as a JavaScript number",
    )
  }

  if (Number.isInteger(number) && !Number.isSafeInteger(number)) {
    throw new TypeError("Nested JSON integer exceeds JavaScript's safe integer range")
  }

  return number
}

function canonicalDecimal(value: string): string {
  const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/u.exec(value)

  if (!match) {
    throw new TypeError("Expected a decimal number")
  }

  let digits = (match[2] + (match[3] ?? "")).replace(/^0+/u, "")

  if (!digits) {
    return "0"
  }

  let exponent = Number(match[4] ?? 0) - (match[3]?.length ?? 0)

  if (!Number.isSafeInteger(exponent)) {
    throw new TypeError("Unsupported decimal exponent")
  }

  const zeros = /0+$/u.exec(digits)?.[0].length ?? 0

  digits = digits.slice(0, digits.length - zeros)
  exponent += zeros
  return `${match[1] === "-" ? "-" : ""}${digits}e${exponent}`
}

function parseExactJson(value: string): unknown {
  // Match complete quoted strings first, so numeric-looking object keys/text are never inspected.
  const tokens = /"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/gu

  for (const token of value.matchAll(tokens)) {
    if (token[0][0] !== '"') {
      exactNumber(token[0])
    }
  }

  return JSON.parse(value) as unknown
}
