import { parenthesize } from '../core/fragment.ts'
import type {
  CapabilityMetadataOf,
  QueryCardinality,
} from '../core/fragment.ts'
import type { Query, QueryRow, QuerySqlTypeMap } from './types.ts'
import type { SqlEqualityCompatible } from '../core/sql-types.ts'
import type { QueryTypeValidation } from './errors.ts'
import type { UnknownSourceSqlTypes } from '../schema/source.ts'

export type SetOperator = 'UNION' | 'UNION ALL' | 'INTERSECT' | 'EXCEPT'

export interface SetQuery<
  TRow extends object = Record<string, unknown>,
  TCardinality extends QueryCardinality = QueryCardinality,
  TMetadata = never,
  TSqlTypes = UnknownSourceSqlTypes<TRow>,
> extends Query<TRow, TCardinality, TMetadata, TSqlTypes> {
  readonly queryKind: 'set'
}

export type SetSqlCompatibilityFailures<TLeft, TRight> = {
  [K in keyof QuerySqlTypeMap<TLeft>]: K extends keyof QuerySqlTypeMap<TRight>
    ? SqlEqualityCompatible<
        QuerySqlTypeMap<TLeft>[K],
        QuerySqlTypeMap<TRight>[K]
      > extends true
      ? never
      : K
    : K
}[keyof QuerySqlTypeMap<TLeft>]

export type SetSqlValidation<TLeft, TRight> = [
  SetSqlCompatibilityFailures<TLeft, TRight>,
] extends [never]
  ? unknown
  : QueryTypeValidation<
      'incompatible-set-domain',
      'set-operation.columns',
      'Make corresponding set-operation fields use compatible SQL domains.',
      SetSqlCompatibilityFailures<TLeft, TRight>
    >

export function setOperation<
  TLeft extends Query<any, any, any, any>,
  TRight extends Query<QueryRow<TLeft>, any, any, any>,
>(
  operator: SetOperator,
  left: TLeft & SetSqlValidation<TLeft, TRight>,
  right: TRight
): SetQuery<
  QueryRow<TLeft>,
  any,
  CapabilityMetadataOf<TLeft | TRight>,
  QuerySqlTypeMap<TLeft>
> {
  return {
    queryKind: 'set',
    row: left.row,
    render: context => {
      context.render(parenthesize(left))
      context.append(` ${operator} `)
      context.render(parenthesize(right))
    },
  } as SetQuery<
    QueryRow<TLeft>,
    any,
    CapabilityMetadataOf<TLeft | TRight>,
    QuerySqlTypeMap<TLeft>
  >
}

export function union<
  TLeft extends Query<any, any, any, any>,
  TRight extends Query<QueryRow<TLeft>, any, any, any>,
>(left: TLeft & SetSqlValidation<TLeft, TRight>, right: TRight) {
  return setOperation('UNION', left, right)
}

export function unionAll<
  TLeft extends Query<any, any, any, any>,
  TRight extends Query<QueryRow<TLeft>, any, any, any>,
>(left: TLeft & SetSqlValidation<TLeft, TRight>, right: TRight) {
  return setOperation('UNION ALL', left, right)
}

export function intersect<
  TLeft extends Query<any, any, any, any>,
  TRight extends Query<QueryRow<TLeft>, any, any, any>,
>(left: TLeft & SetSqlValidation<TLeft, TRight>, right: TRight) {
  return setOperation('INTERSECT', left, right)
}

export function except<
  TLeft extends Query<any, any, any, any>,
  TRight extends Query<QueryRow<TLeft>, any, any, any>,
>(left: TLeft & SetSqlValidation<TLeft, TRight>, right: TRight) {
  return setOperation('EXCEPT', left, right)
}
