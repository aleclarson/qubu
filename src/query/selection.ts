import type { Fragment, RenderContext } from '../core/fragment.ts'
import type { AnySource, SourceIdentity, SourceRow } from '../schema/source.ts'
import type { AliasedExpression } from '../expressions/alias.ts'
import type { ColumnReference } from '../expressions/column.ts'
import type { AnyExpression } from '../expressions/types.ts'

export interface Wildcard<
  TRequires = any,
  TRow extends object = Record<string, unknown>,
> extends Fragment<readonly TRow[], TRequires, never> {
  readonly selectionKind: 'wildcard'
  readonly source?: AnySource
}

export function all<TSource extends AnySource>(
  source: TSource
): Wildcard<SourceIdentity<TSource>, SourceRow<TSource>>
export function all(): Wildcard<never, Record<string, unknown>>
export function all(source?: AnySource): Wildcard {
  return Object.freeze({
    selectionKind: 'wildcard' as const,
    source,
    render: (context: RenderContext) => {
      if (source) {
        context.render(source.reference)
        context.append('.*')
      } else {
        context.append('*')
      }
    },
  })
}

export type SelectableItem =
  | ColumnReference<any, any, any>
  | AliasedExpression<any, any, any, any>
  | Wildcard<any, any>
export type SelectionObject = Record<string, AnyExpression>
export type Selection =
  | SelectionObject
  | readonly SelectableItem[]
  | SelectableItem

type SelectionItems<TSelection> = TSelection extends readonly (infer TItem)[]
  ? TItem
  : TSelection extends SelectionObject
    ? TSelection[keyof TSelection]
    : TSelection

type ItemOutput<TItem> =
  TItem extends Wildcard<any, infer TRow>
    ? TRow
    : TItem extends AliasedExpression<infer TOutput, infer TAlias, any, any>
      ? { [K in TAlias]: TOutput }
      : TItem extends ColumnReference<infer TOutput, infer TName, any>
        ? { [K in TName]: TOutput }
        : never

type UnionToIntersection<T> = (
  T extends unknown ? (value: T) => void : never
) extends (value: infer TIntersection) => void
  ? TIntersection
  : never

type Simplify<T> = { [K in keyof T]: T[K] } & {}

export type SelectionOutput<TSelection> = TSelection extends SelectionObject
  ? Simplify<{
      -readonly [K in keyof TSelection]: TSelection[K] extends AnyExpression
        ? import('../expressions/types.ts').ExpressionOutput<TSelection[K]>
        : never
    }>
  : Simplify<UnionToIntersection<ItemOutput<SelectionItems<TSelection>>>>

export type SelectionRequires<TSelection> =
  SelectionItems<TSelection> extends Fragment<any, infer TRequires, any>
    ? TRequires
    : never

export type SelectionParameters<TSelection> =
  SelectionItems<TSelection> extends Fragment<any, any, infer TParameters>
    ? TParameters
    : never

export function isWildcard(value: unknown): value is Wildcard {
  return (
    typeof value === 'object' &&
    value !== null &&
    'selectionKind' in value &&
    value.selectionKind === 'wildcard'
  )
}
