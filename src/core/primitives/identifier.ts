import { fragment, type Fragment } from "../fragment.ts"

export function identifier(name: string): Fragment<never> {
  return fragment((context) => context.append(context.dialect.quoteIdentifier(name)))
}

export function qualifiedIdentifier(...parts: readonly string[]): Fragment<never> {
  return fragment((context) => {
    parts.forEach((part, index) => {
      if (index > 0) {
        context.append(".")
      }

      context.append(context.dialect.quoteIdentifier(part))
    })
  })
}
