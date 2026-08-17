import { fragment } from '../fragment.ts'

/** Emit trusted SQL syntax. Never pass user data to this primitive. */
export function syntax(value: string) {
  return fragment(context => context.append(value))
}

/** Emit a deliberately unchecked fragment supplied by the caller. */
export const unsafe = syntax
