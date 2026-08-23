import { parenthesize } from '../core/fragment.ts'
import type { CapabilityMetadataOf } from '../core/fragment.ts'
import type { Query, QuerySqlTypeMap } from './types.ts'
import type { SqlEqualityCompatible } from '../core/sql-types.ts'
import type { QueryTypeValidation } from './errors.ts'

export type SetOperator = 'UNION' | 'UNION ALL' | 'INTERSECT' | 'EXCEPT'

type SetSqlCompatibilityFailures<TLeft, TRight> = {
  [K in keyof QuerySqlTypeMap<TLeft>]: K extends keyof QuerySqlTypeMap<TRight>
    ? SqlEqualityCompatible<
        QuerySqlTypeMap<TLeft>[K],
        QuerySqlTypeMap<TRight>[K]
      > extends true
      ? never
      : K
    : K
}[keyof QuerySqlTypeMap<TLeft>]

type SetSqlValidation<TLeft, TRight> = [
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
  TRow extends object,
  TLeft extends Query<TRow, any, any>,
  TRight extends Query<TRow, any, any>,
>(
  operator: SetOperator,
  left: TLeft & SetSqlValidation<TLeft, TRight>,
  right: TRight
): Query<
  TRow,
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
  } as Query<
    TRow,
    any,
    CapabilityMetadataOf<TLeft | TRight>,
    QuerySqlTypeMap<TLeft>
  >
}

export function union<
  TRow extends object,
  TLeft extends Query<TRow, any, any>,
  TRight extends Query<TRow, any, any>,
>(left: TLeft & SetSqlValidation<TLeft, TRight>, right: TRight) {
  return setOperation('UNION', left, right)
}

export function unionAll<
  TRow extends object,
  TLeft extends Query<TRow, any, any>,
  TRight extends Query<TRow, any, any>,
>(left: TLeft & SetSqlValidation<TLeft, TRight>, right: TRight) {
  return setOperation('UNION ALL', left, right)
}

export function intersect<
  TRow extends object,
  TLeft extends Query<TRow, any, any>,
  TRight extends Query<TRow, any, any>,
>(left: TLeft & SetSqlValidation<TLeft, TRight>, right: TRight) {
  return setOperation('INTERSECT', left, right)
}

export function except<
  TRow extends object,
  TLeft extends Query<TRow, any, any>,
  TRight extends Query<TRow, any, any>,
>(left: TLeft & SetSqlValidation<TLeft, TRight>, right: TRight) {
  return setOperation('EXCEPT', left, right)
}
