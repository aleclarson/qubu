import { fragment, parenthesize, sequence, type Fragment } from '../fragment.ts'

export { parenthesize, sequence }

export function commaSeparated(parts: readonly Fragment[]) {
  return sequence(parts, ', ')
}

export function keyword(value: string, part?: Fragment) {
  return fragment(context => {
    context.append(value)
    if (part) {
      context.append(' ')
      context.render(part)
    }
  })
}
