import { parenthesize } from '../core/fragment.ts'
import type { Query } from './types.ts'

export type SetOperator = 'UNION' | 'UNION ALL' | 'INTERSECT' | 'EXCEPT'

export function setOperation<TRow extends object, TRight extends Query<TRow>>(
  operator: SetOperator,
  left: Query<TRow>,
  right: TRight
): Query<TRow> {
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

export function union<TRow extends object, TRight extends Query<TRow>>(
  left: Query<TRow>,
  right: TRight
) {
  return setOperation('UNION', left, right)
}

export function unionAll<TRow extends object, TRight extends Query<TRow>>(
  left: Query<TRow>,
  right: TRight
) {
  return setOperation('UNION ALL', left, right)
}

export function intersect<TRow extends object, TRight extends Query<TRow>>(
  left: Query<TRow>,
  right: TRight
) {
  return setOperation('INTERSECT', left, right)
}

export function except<TRow extends object, TRight extends Query<TRow>>(
  left: Query<TRow>,
  right: TRight
) {
  return setOperation('EXCEPT', left, right)
}
