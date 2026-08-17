import { fragment } from '../fragment.ts'

const routinePart = /^[A-Za-z_][A-Za-z0-9_$]*$/

/** Render a validated, unquoted SQL routine name such as `LOWER` or `app.fn`. */
export function routineName(name: string) {
  const parts = name.split('.')
  if (parts.length === 0 || parts.some(part => !routinePart.test(part))) {
    throw new Error(`Invalid SQL routine name: ${name}`)
  }

  return fragment(context => context.append(parts.join('.')))
}
