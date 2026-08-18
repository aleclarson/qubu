import {
  type InheritedMetadata,
  type NullabilityOf,
  type RequiresOf,
} from '../core/fragment.ts'
import type {
  AnySource,
  SourceColumns,
  SourceIdentity,
  SourceRow,
} from '../schema/source.ts'
import type { AnyExpression } from '../expressions/types.ts'

/**
 * Return every known source column as a named projection object.
 *
 * The result can be passed directly to `select()` or spread into a larger
 * projection, such as `{ ...all(users), displayName: upper(users.name) }`.
 */
export function all<TSource extends AnySource>(
  source: TSource
): SourceColumns<SourceRow<TSource>, SourceIdentity<TSource>> {
  // `all(source)` is a projection object rather than a SQL wildcard. This
  // makes it usable directly or inside an object spread while keeping every
  // output field named at the selection boundary.
  return Object.freeze({ ...source.columns }) as SourceColumns<
    SourceRow<TSource>,
    SourceIdentity<TSource>
  >
}

export type SelectionObject = Record<string, AnyExpression>
export type Selection = SelectionObject

export type SelectionItems<TSelection> = TSelection extends SelectionObject
  ? TSelection[keyof TSelection]
  : never

type NullableOutput<TOutput, TExpression, TNullableSources> = [
  Extract<NullabilityOf<TExpression>, TNullableSources>,
] extends [never]
  ? TOutput
  : TOutput | null

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
  : never

export type SelectionRequires<TSelection> = RequiresOf<
  SelectionItems<TSelection>
>
export type SelectionMetadata<TSelection> = InheritedMetadata<
  SelectionItems<TSelection>
>
