import { parenthesize } from "../core/fragment.ts"
import type { CapabilityMetadataOf } from "../core/fragment.ts"
import type { SqlEqualityCompatible } from "../core/sql-types.ts"
import type { QueryTypeValidation } from "./errors.ts"
import type {
  AnyQuery,
  Query,
  QueryConfig,
  QueryRow,
  QuerySqlTypeMap,
  QueryWithRow,
} from "./types.ts"

export type SetOperator = "UNION" | "UNION ALL" | "INTERSECT" | "EXCEPT"

export interface SetQuery<TConfig extends QueryConfig = {}> extends Query<TConfig> {
  readonly queryKind: "set"
}

export type SetSqlCompatibilityFailures<TLeft, TRight> = {
  [K in keyof QuerySqlTypeMap<TLeft>]: K extends keyof QuerySqlTypeMap<TRight>
    ? SqlEqualityCompatible<QuerySqlTypeMap<TLeft>[K], QuerySqlTypeMap<TRight>[K]> extends true
      ? never
      : K
    : K
}[keyof QuerySqlTypeMap<TLeft>]

export type SetSqlValidation<TLeft, TRight> = [SetSqlCompatibilityFailures<TLeft, TRight>] extends [
  never,
]
  ? unknown
  : QueryTypeValidation<
      "incompatible-set-domain",
      "set-operation.columns",
      "Make corresponding set-operation fields use compatible SQL domains.",
      SetSqlCompatibilityFailures<TLeft, TRight>
    >

/** SQL combines fields positionally, so both operands must project the same keys. */
export type SetKeyValidation<TLeft, TRight> = [
  Exclude<keyof QueryRow<TRight>, keyof QueryRow<TLeft>>,
] extends [never]
  ? unknown
  : QueryTypeValidation<
      "incompatible-set-domain",
      "set-operation.columns",
      "Set operands must project the same fields in the same order.",
      Exclude<keyof QueryRow<TRight>, keyof QueryRow<TLeft>>
    >

/**
 * Combine queries using the left projection's row shape, SQL domains, and decoders.
 *
 * Use matching projection keys in matching order. Type compatibility is checked by field name,
 * while SQL combines fields positionally; this does not reorder or runtime-validate projections.
 */
export function setOperation<TLeft extends AnyQuery, TRight extends QueryWithRow<QueryRow<TLeft>>>(
  operator: SetOperator,
  left: TLeft & SetSqlValidation<TLeft, TRight>,
  right: TRight & SetKeyValidation<TLeft, TRight>,
): SetQuery<{
  readonly row: QueryRow<TLeft>
  readonly cardinality: any
  readonly metadata: CapabilityMetadataOf<TLeft | TRight>
  readonly sqlTypes: QuerySqlTypeMap<TLeft>
}> {
  return {
    queryKind: "set",
    row: left.row,
    resultShape: left.resultShape,
    render: (context) => {
      // SQLite compound operands cannot be bare parenthesized SELECTs. A derived
      // SELECT preserves each operand's ORDER BY/LIMIT and compound precedence.
      if (context.dialect.name === "sqlite") {
        context.append("SELECT * FROM ")
      }

      context.render(parenthesize(left))
      context.append(` ${operator} `)
      if (context.dialect.name === "sqlite") {
        context.append("SELECT * FROM ")
      }

      context.render(parenthesize(right))
    },
  } as SetQuery<{
    readonly row: QueryRow<TLeft>
    readonly cardinality: any
    readonly metadata: CapabilityMetadataOf<TLeft | TRight>
    readonly sqlTypes: QuerySqlTypeMap<TLeft>
  }>
}

/** Combine distinct rows under the positional projection contract of {@link setOperation}. */
export function union<TLeft extends AnyQuery, TRight extends QueryWithRow<QueryRow<TLeft>>>(
  left: TLeft & SetSqlValidation<TLeft, TRight>,
  right: TRight & SetKeyValidation<TLeft, TRight>,
) {
  return setOperation<TLeft, TRight>("UNION", left, right)
}

/** Combine rows including duplicates; projection order must match as in {@link setOperation}. */
export function unionAll<TLeft extends AnyQuery, TRight extends QueryWithRow<QueryRow<TLeft>>>(
  left: TLeft & SetSqlValidation<TLeft, TRight>,
  right: TRight & SetKeyValidation<TLeft, TRight>,
) {
  return setOperation<TLeft, TRight>("UNION ALL", left, right)
}

/** Intersect rows using the positional projection contract of {@link setOperation}. */
export function intersect<TLeft extends AnyQuery, TRight extends QueryWithRow<QueryRow<TLeft>>>(
  left: TLeft & SetSqlValidation<TLeft, TRight>,
  right: TRight & SetKeyValidation<TLeft, TRight>,
) {
  return setOperation<TLeft, TRight>("INTERSECT", left, right)
}

/** Subtract right rows using the positional projection contract of {@link setOperation}. */
export function except<TLeft extends AnyQuery, TRight extends QueryWithRow<QueryRow<TLeft>>>(
  left: TLeft & SetSqlValidation<TLeft, TRight>,
  right: TRight & SetKeyValidation<TLeft, TRight>,
) {
  return setOperation<TLeft, TRight>("EXCEPT", left, right)
}
