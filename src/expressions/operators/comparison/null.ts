import { syntax } from '../../../core/primitives/syntax.ts'
import { makeExpression, type Expression } from '../../types.ts'
import { type OperandParameters, type OperandRequires } from '../shared.ts'
import type { BooleanExpression } from './types.ts'

export function isNull<T, TRequires, TParameters>(
  expression: Expression<T, TRequires, TParameters, any>
): BooleanExpression<TRequires, TParameters> {
  return makeExpression('operator', context => {
    context.append('(')
    context.render(expression)
    context.append(' IS NULL)')
  })
}

export function isNotNull<T, TRequires, TParameters>(
  expression: Expression<T, TRequires, TParameters, any>
): BooleanExpression<TRequires, TParameters> {
  return makeExpression('operator', context => {
    context.append('(')
    context.render(expression)
    context.append(' IS NOT NULL)')
  })
}

export function isTrue(expression: Expression<boolean, any, any, any>) {
  return makeExpression('operator', context => {
    context.render(expression)
    context.render(syntax(' IS TRUE'))
  }) as BooleanExpression<
    OperandRequires<typeof expression>,
    OperandParameters<typeof expression>
  >
}
