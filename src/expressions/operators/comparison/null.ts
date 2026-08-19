import {
  makeSchemaExpression,
  type AnyExpression,
  type ExpressionWithOutput,
  type ResultExpression,
} from '../../types.ts'
import type { SqlBoolean } from '../../../core/sql-types.ts'
import type { ExpressionSqlType } from '../../types.ts'
import type { SqlCapabilityValidation } from '../shared.ts'

export function isNull<TExpression extends AnyExpression>(
  expression: TExpression
): ResultExpression<boolean, TExpression, 'operator', never, SqlBoolean> {
  return makeSchemaExpression('operator', context => {
    context.append('(')
    context.render(expression)
    context.append(' IS NULL)')
  }) as ResultExpression<boolean, TExpression, 'operator', never, SqlBoolean>
}

export function isNotNull<TExpression extends AnyExpression>(
  expression: TExpression
): ResultExpression<boolean, TExpression, 'operator', never, SqlBoolean> {
  return makeSchemaExpression('operator', context => {
    context.append('(')
    context.render(expression)
    context.append(' IS NOT NULL)')
  }) as ResultExpression<boolean, TExpression, 'operator', never, SqlBoolean>
}

export function isTrue<TExpression extends ExpressionWithOutput<boolean>>(
  expression: TExpression &
    SqlCapabilityValidation<ExpressionSqlType<TExpression>, SqlBoolean>
) {
  return makeSchemaExpression('operator', context => {
    context.render(expression)
    context.append(' IS TRUE')
  }) as ResultExpression<boolean, TExpression, 'operator', never, SqlBoolean>
}
