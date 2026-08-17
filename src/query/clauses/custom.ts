import type { RenderContext } from '../../core/fragment.ts'
import {
  createClause,
  type ClausePlacement,
  type SelectClause,
} from './types.ts'

export function customClause<TRequires = never, TParameters = never>(options: {
  readonly name: string
  readonly placement?: ClausePlacement
  readonly order: number
  readonly render: (context: RenderContext) => void
}): SelectClause<TRequires, TParameters> {
  return createClause(
    options.name,
    options.placement ?? 'after-select',
    options.order,
    options.render
  )
}
