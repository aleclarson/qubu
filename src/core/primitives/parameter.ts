import { fragment, type Fragment } from '../fragment.ts'

export function parameter<T>(_value: T): Fragment<never> {
  return fragment(context => context.parameter(_value))
}
