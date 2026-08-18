import type {
  Fragment,
  InheritedMetadata,
  NullabilityOf,
  RequiresOf,
  RenderContext,
} from '../../core/fragment.ts'
import { asValue, isValueExpression, type ValueExpression } from '../value.ts'
import type { AnyExpression, ExpressionWithOutput } from '../types.ts'

export type Operand<T> = T | ExpressionWithOutput<T>

export type OperandRequires<T> = T extends Fragment<any> ? RequiresOf<T> : never

export type OperandMetadata<T> =
  T extends Fragment<any> ? InheritedMetadata<T> : never

export type OperandNullability<T> =
  T extends Fragment<any> ? NullabilityOf<T> : never

export type IsNullOperand<T> = T extends null
  ? true
  : T extends ValueExpression<infer TValue>
    ? [TValue] extends [null]
      ? true
      : false
    : false

export function isNullOperand(value: unknown): boolean {
  return value === null || (isValueExpression(value) && value.value === null)
}

export function expressionOperand<T>(operand: Operand<T>) {
  return asValue(operand)
}

export function renderOperands(
  context: RenderContext,
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
export type MetadataOfOperands<T extends readonly unknown[]> = OperandMetadata<
  T[number]
>
