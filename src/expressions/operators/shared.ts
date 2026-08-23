import type {
  Fragment,
  InheritedMetadata,
  NullabilityOf,
  RequiresOf,
  RenderContext,
  SqlTypeOf,
} from '../../core/fragment.ts'
import type {
  AnySqlType,
  SqlEqualityCompatible,
  SqlOrderCompatible,
  SqlTypeSatisfies,
} from '../../core/sql-types.ts'
import { asValue, isValueExpression, type ValueExpression } from '../value.ts'
import type { AnyExpression, ExpressionWithOutput } from '../types.ts'
import type { QueryTypeValidation } from '../../query/errors.ts'

export type Operand<T> = T | ExpressionWithOutput<T>

/** Plain values are contextually typed by the expression beside them. */
export type OperandSqlType<T, TContext extends AnySqlType> =
  T extends Fragment<any> ? SqlTypeOf<T> : TContext

/** Type-level validation that a known SQL domain provides a capability. */
export type SqlCapabilityValidation<TActual, TCapability> =
  SqlTypeSatisfies<TActual, TCapability> extends true
    ? unknown
    : QueryTypeValidation<
        'incompatible-sql-domain',
        'expression.sql-domain',
        'Use an expression with the required SQL domain.',
        TActual
      >

/** Type-level validation that two known SQL domains can test equality. */
export type SqlEqualityValidation<TLeft, TRight> =
  SqlEqualityCompatible<TLeft, TRight> extends true
    ? unknown
    : QueryTypeValidation<
        'incompatible-sql-equality',
        'comparison.operands',
        'Use operands from the same SQL equality group.',
        readonly [TLeft, TRight]
      >

/** Type-level validation that two known SQL domains share an ordering group. */
export type SqlOrderValidation<TLeft, TRight> =
  SqlOrderCompatible<TLeft, TRight> extends true
    ? unknown
    : QueryTypeValidation<
        'incompatible-sql-order',
        'comparison.operands',
        'Use operands from the same SQL ordering group.',
        readonly [TLeft, TRight]
      >

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
