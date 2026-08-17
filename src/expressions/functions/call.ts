import { routineName } from '../../core/primitives/routine.ts'
import { asValue } from '../value.ts'
import { makeExpression, type Expression } from '../types.ts'
import {
  type OperandParameters,
  type OperandRequires,
} from '../operators/shared.ts'

export type FunctionArguments<T extends readonly unknown[]> = OperandRequires<
  T[number]
>

export function call<
  TOutput = unknown,
  const TName extends string = string,
  const TArguments extends readonly unknown[] = readonly unknown[],
>(name: TName, ...args: TArguments) {
  const expressions = args.map(argument => asValue(argument as never))
  return makeExpression('function', context => {
    context.render(routineName(name))
    context.append('(')
    expressions.forEach((argument, index) => {
      if (index > 0) context.append(', ')
      context.render(argument)
    })
    context.append(')')
  }) as Expression<
    TOutput,
    FunctionArguments<TArguments>,
    OperandParameters<TArguments>,
    'function'
  >
}
