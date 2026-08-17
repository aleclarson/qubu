import { makeExpression, type Expression } from './types.ts'

/** Cast using a type name supplied by the caller or an adapter. */
export function cast<T, TRequires, TParameters, const TType extends string>(
  expression: Expression<T, TRequires, TParameters, any>,
  typeName: TType
) {
  return makeExpression<T, TRequires, TParameters, 'operator'>(
    'operator',
    context => {
      context.append('CAST(')
      context.render(expression)
      context.append(' AS ')
      context.append(typeName)
      context.append(')')
    }
  )
}
