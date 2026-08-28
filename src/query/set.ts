import { parenthesize } from '../core/fragment.ts'
import type { CapabilityMetadataOf } from '../core/fragment.ts'
import type {
  AnyQuery,
  QueryConfig,
  QueryRow,
  QuerySqlTypeMap,
  QueryWithRow,
} from './types.ts'
import type { SqlEqualityCompatible } from '../core/sql-types.ts'
import type { QueryTypeValidation } from './errors.ts'

export type SetOperator = 'UNION' | 'UNION ALL' | 'INTERSECT' | 'EXCEPT'

export interface SetQuery<TConfig extends QueryConfig = {}>
  extends Query<TConfig> {
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
  TLeft extends AnyQuery,
  TRight extends QueryWithRow<QueryRow<TLeft>>,
>(
  operator: SetOperator,
  left: TLeft & SetSqlValidation<TLeft, TRight>,
  right: TRight
): SetQuery<{
  readonly row: QueryRow<TLeft>
  readonly cardinality: any
  readonly metadata: CapabilityMetadataOf<TLeft | TRight>
  readonly sqlTypes: QuerySqlTypeMap<TLeft>
}> {
  return {
    queryKind: 'set',
    row: left.row,
    resultShape: left.resultShape,
    render: context => {
      context.render(parenthesize(left))
      context.append(` ${operator} `)
      context.render(parenthesize(right))
    },
  } as SetQuery<{
    readonly row: QueryRow<TLeft>
    readonly cardinality: any
    readonly metadata: CapabilityMetadataOf<TLeft | TRight>
    readonly sqlTypes: QuerySqlTypeMap<TLeft>
  }>
}

export function union<
  TLeft extends AnyQuery,
  TRight extends QueryWithRow<QueryRow<TLeft>>,
>(left: TLeft & SetSqlValidation<TLeft, TRight>, right: TRight) {
  return setOperation('UNION', left, right)
}

export function unionAll<
  TLeft extends AnyQuery,
  TRight extends QueryWithRow<QueryRow<TLeft>>,
>(left: TLeft & SetSqlValidation<TLeft, TRight>, right: TRight) {
  return setOperation('UNION ALL', left, right)
}

export function intersect<
  TLeft extends AnyQuery,
  TRight extends QueryWithRow<QueryRow<TLeft>>,
>(left: TLeft & SetSqlValidation<TLeft, TRight>, right: TRight) {
  return setOperation('INTERSECT', left, right)
}

export function except<
  TLeft extends AnyQuery,
  TRight extends QueryWithRow<QueryRow<TLeft>>,
>(left: TLeft & SetSqlValidation<TLeft, TRight>, right: TRight) {
  return setOperation('EXCEPT', left, right)
}
