import type { RenderContext } from '../../core/fragment.ts'
import { identifier } from '../../core/primitives/identifier.ts'
import { snakeCaseIdentifier } from '../../core/naming.ts'
import { isExpression } from '../../expressions/types.ts'
import type { Selection } from '../selection.ts'

export function renderSelection(selection: Selection, context: RenderContext) {
  assertNamedSelection(selection)
  const entries = Object.entries(selection)
  if (entries.length === 0)
    throw new Error('select() requires at least one field')
  entries.forEach(([name, expression], index) => {
    if (index > 0) context.append(', ')
    if (!isExpression(expression)) {
      throw new TypeError(`Selection field "${name}" must be an expression`)
    }

    const outputName =
      context.projectionMode === 'result' ? name : snakeCaseIdentifier(name)
    context.render(expression)
    context.append(' AS ')
    context.render(identifier(outputName))
  })
}

export function selectionRow(selection: Selection): Record<string, unknown> {
  assertNamedSelection(selection)
  return Object.fromEntries(
    Object.keys(selection).map(name => [name, undefined])
  )
}

function assertNamedSelection(selection: Selection) {
  if (Array.isArray(selection)) {
    throw new TypeError('Selection must be a named object projection')
  }
}
