import { fragment, type Fragment } from '../fragment.ts'

export function parameter<T>(value: T): Fragment<unknown, never, T> {
  return fragment(context => context.parameter(value))
}
