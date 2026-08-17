import type { Fragment, ParametersOf, RequiresOf } from '../../core/fragment.ts'
import { asValue, isValueExpression, type ValueExpression } from '../value.ts'
import type { AnyExpression, Expression } from '../types.ts'

export type Operand<T> = T | Expression<T, any, any, any>

export type OperandRequires<T> =
  T extends Fragment<any, infer TRequires, any> ? TRequires : never

export type OperandParameters<T> =
  T extends Fragment<any, any, infer TParameters> ? TParameters : T

export type IsNullOperand<T> = T extends null
  ? true
  : T extends ValueExpression<infer TValue>
    ? [TValue] extends [null]
      ? true
      : false
    : false

export type ComparisonParameters<
  T,
  TOperator extends string,
> = TOperator extends '=' | '<>'
  ? IsNullOperand<T> extends true
    ? never
    : OperandParameters<T>
  : OperandParameters<T>

export function isNullOperand(value: unknown): boolean {
  return value === null || (isValueExpression(value) && value.value === null)
}

export function expressionOperand<T>(operand: Operand<T>) {
  return asValue(operand as T | Expression<T, any, any, any>)
}

export function renderOperands(
  context: Parameters<Fragment['render']>[0],
  operands: readonly AnyExpression[],
  separator: string
) {
  operands.forEach((operand, index) => {
    if (index > 0) context.append(separator)
    context.render(operand)
  })
}

export type RequirementsOf<T extends readonly unknown[]> = OperandRequires<
  T[number]
>
export type ParametersOfOperands<T extends readonly unknown[]> =
  OperandParameters<T[number]>
export type { ParametersOf, RequiresOf }
