import {
  type Fragment,
  type InheritedMetadata,
  type NullabilityOf,
  type OutputOf,
  type RequiresOf,
  type ResultMeta,
  type RequiresSourceMeta,
  type RenderContext,
} from '../core/fragment.ts'
import type { AnySource, SourceIdentity, SourceRow } from '../schema/source.ts'
import type { AliasedExpression } from '../expressions/alias.ts'
import type { ColumnReference } from '../expressions/column.ts'
import type { AnyExpression } from '../expressions/types.ts'

export interface Wildcard<
  TRow extends object = Record<string, unknown>,
  TMetadata = never,
> extends Fragment<TMetadata> {
  readonly selectionKind: 'wildcard'
  readonly source?: AnySource
  readonly row?: TRow
}

export function all<TSource extends AnySource>(
  source: TSource
): Wildcard<
  SourceRow<TSource>,
  | ResultMeta<SourceRow<TSource>, SourceIdentity<TSource>>
  | RequiresSourceMeta<SourceIdentity<TSource>>
>
export function all(): Wildcard<
  Record<string, unknown>,
  ResultMeta<Record<string, unknown>>
>
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
  | ColumnReference<any, any>
  | AliasedExpression<any, any, any>
  | Wildcard<any, any>
export type SelectionObject = Record<string, AnyExpression>
export type Selection =
  | SelectionObject
  | readonly SelectableItem[]
  | SelectableItem

export type SelectionItems<TSelection> =
  TSelection extends readonly (infer TItem)[]
    ? TItem
    : TSelection extends SelectionObject
      ? TSelection[keyof TSelection]
      : TSelection

type NullableRow<TRow extends object> = {
  [K in keyof TRow]: TRow[K] | null
}

type NullableOutput<TOutput, TExpression, TNullableSources> = [
  Extract<NullabilityOf<TExpression>, TNullableSources>,
] extends [never]
  ? TOutput
  : TOutput | null

type ItemOutput<TItem, TNullableSources> =
  TItem extends Wildcard<infer TRow, any>
    ? [Extract<NullabilityOf<TItem>, TNullableSources>] extends [never]
      ? TRow
      : NullableRow<TRow>
    : TItem extends AliasedExpression<infer TAlias, any, any>
      ? {
          [K in TAlias]: NullableOutput<
            OutputOf<TItem>,
            TItem,
            TNullableSources
          >
        }
      : TItem extends ColumnReference<infer TName, any>
        ? {
            [K in TName]: NullableOutput<
              OutputOf<TItem>,
              TItem,
              TNullableSources
            >
          }
        : never

type UnionToIntersection<T> = (
  T extends unknown ? (value: T) => void : never
) extends (value: infer TIntersection) => void
  ? TIntersection
  : never

type Simplify<T> = { [K in keyof T]: T[K] } & {}

export type SelectionOutput<
  TSelection,
  TNullableSources = never,
> = TSelection extends SelectionObject
  ? Simplify<{
      -readonly [K in keyof TSelection]: TSelection[K] extends AnyExpression
        ? NullableOutput<
            import('../expressions/types.ts').ExpressionOutput<TSelection[K]>,
            TSelection[K],
            TNullableSources
          >
        : never
    }>
  : Simplify<
      UnionToIntersection<
        ItemOutput<SelectionItems<TSelection>, TNullableSources>
      >
    >

export type SelectionRequires<TSelection> = RequiresOf<
  SelectionItems<TSelection>
>
export type SelectionMetadata<TSelection> = InheritedMetadata<
  SelectionItems<TSelection>
>

export function isWildcard(value: unknown): value is Wildcard {
  return (
    typeof value === 'object' &&
    value !== null &&
    'selectionKind' in value &&
    value.selectionKind === 'wildcard'
  )
}
