import { fragment } from '../fragment.ts'

export function identifier(name: string) {
  return fragment(context =>
    context.append(context.dialect.quoteIdentifier(name))
  )
}

export function qualifiedIdentifier(...parts: readonly string[]) {
  return fragment(context => {
    parts.forEach((part, index) => {
      if (index > 0) context.append('.')
      context.append(context.dialect.quoteIdentifier(part))
    })
  })
}
