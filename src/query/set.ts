import { parenthesize } from '../core/fragment.ts'
import type { CapabilityMetadataOf } from '../core/fragment.ts'
import type { Query } from './types.ts'

export type SetOperator = 'UNION' | 'UNION ALL' | 'INTERSECT' | 'EXCEPT'

export function setOperation<
  TRow extends object,
  TLeft extends Query<TRow, any, any>,
  TRight extends Query<TRow, any, any>,
>(
  operator: SetOperator,
  left: TLeft,
  right: TRight
): Query<TRow, any, CapabilityMetadataOf<TLeft | TRight>> {
  return {
    queryKind: 'set',
    row: left.row,
    render: context => {
      context.render(parenthesize(left))
      context.append(` ${operator} `)
      context.render(parenthesize(right))
    },
  } as Query<TRow>
}

export function union<
  TRow extends object,
  TLeft extends Query<TRow, any, any>,
  TRight extends Query<TRow, any, any>,
>(left: TLeft, right: TRight) {
  return setOperation('UNION', left, right)
}

export function unionAll<
  TRow extends object,
  TLeft extends Query<TRow, any, any>,
  TRight extends Query<TRow, any, any>,
>(left: TLeft, right: TRight) {
  return setOperation('UNION ALL', left, right)
}

export function intersect<
  TRow extends object,
  TLeft extends Query<TRow, any, any>,
  TRight extends Query<TRow, any, any>,
>(left: TLeft, right: TRight) {
  return setOperation('INTERSECT', left, right)
}

export function except<
  TRow extends object,
  TLeft extends Query<TRow, any, any>,
  TRight extends Query<TRow, any, any>,
>(left: TLeft, right: TRight) {
  return setOperation('EXCEPT', left, right)
}
