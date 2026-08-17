import type { RenderContext } from '../../core/fragment.ts'
import { identifier } from '../../core/primitives/identifier.ts'
import { isColumnReference } from '../../expressions/column.ts'
import { isExpression } from '../../expressions/types.ts'
import type { SelectableItem, Selection, Wildcard } from '../selection.ts'
import { isWildcard } from '../selection.ts'

export function renderSelection(selection: Selection, context: RenderContext) {
  if (Array.isArray(selection)) {
    if (selection.length === 0)
      throw new Error('select() requires at least one field')
    selection.forEach((item, index) => {
      if (index > 0) context.append(', ')
      renderSelectionItem(item, context)
    })
    return
  }

  if (isWildcard(selection) || isExpression(selection)) {
    renderSelectionItem(selection as SelectableItem, context)
    return
  }

  const entries = Object.entries(selection)
  if (entries.length === 0)
    throw new Error('select() requires at least one field')
  entries.forEach(([name, expression], index) => {
    if (index > 0) context.append(', ')
    if (!isExpression(expression)) {
      throw new TypeError(`Selection field "${name}" must be an expression`)
    }

    if (
      expression.expressionKind === 'alias' &&
      'aliasName' in expression &&
      expression.aliasName === name
    ) {
      context.render(expression)
    } else {
      context.render(expression)
      context.append(' AS ')
      context.render(identifier(name))
    }
  })
}

function renderSelectionItem(item: SelectableItem, context: RenderContext) {
  if (isWildcard(item)) {
    context.render(item)
    return
  }
  if (!isExpression(item)) {
    throw new TypeError('Invalid select item')
  }
  if (isColumnReference(item)) {
    context.render(item)
    return
  }
  if (item.expressionKind === 'alias') {
    context.render(item)
    return
  }
  throw new TypeError('Non-column select expressions require an alias')
}

export function selectionRow(selection: Selection): Record<string, unknown> {
  if (Array.isArray(selection)) {
    return selection.reduce<Record<string, unknown>>((row, item) => {
      Object.assign(row, itemRow(item))
      return row
    }, {})
  }

  if (isWildcard(selection)) return wildcardRow(selection)
  if (isExpression(selection)) return itemRow(selection as SelectableItem)

  return Object.fromEntries(
    Object.keys(selection).map(name => [name, undefined])
  )
}

function itemRow(item: SelectableItem): Record<string, unknown> {
  if (isWildcard(item)) return wildcardRow(item)
  if (!isExpression(item)) return {}
  if (item.expressionKind === 'alias' && 'aliasName' in item) {
    return { [item.aliasName]: undefined }
  }
  if (isColumnReference(item)) return { [item.columnName]: undefined }
  return {}
}

function wildcardRow(item: Wildcard): Record<string, unknown> {
  if (!item.source) return {}
  return Object.fromEntries(
    Object.keys(item.source.columns).map(name => [name, undefined])
  )
}
