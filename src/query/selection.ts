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
  SourceSqlTypeMap,
} from '../schema/source.ts'
import type { AnyExpression } from '../expressions/types.ts'
import { omit, type Omit } from './omit.ts'
import {
  createResultShape,
  resultValueOf,
  type ResultShape,
} from '../result.ts'

/**
 * Return every known source column as a named projection object.
 *
 * The result can be passed directly to `select()` or spread into a larger
 * projection, such as `{ ...all(users), displayName: upper(users.name) }`.
 */
export function all<TSource extends AnySource>(
  source: TSource
): SourceColumns<
  SourceRow<TSource>,
  SourceIdentity<TSource>,
  SourceSqlTypeMap<TSource>
> {
  // `all(source)` is a projection object rather than a SQL wildcard. This
  // makes it usable directly or inside an object spread while keeping every
  // output field named at the selection boundary.
  return Object.freeze({ ...source.columns }) as SourceColumns<
    SourceRow<TSource>,
    SourceIdentity<TSource>,
    SourceSqlTypeMap<TSource>
  >
}

export type SelectionObject = Record<string, AnyExpression | Omit>
export type Selection = SelectionObject

export type SelectionItems<TSelection> = TSelection extends SelectionObject
  ? Extract<TSelection[keyof TSelection], AnyExpression>
  : never

type NullableOutput<TOutput, TExpression, TNullableSources> = [
  Extract<NullabilityOf<TExpression>, TNullableSources>,
] extends [never]
  ? TOutput
  : TOutput | null

type Simplify<T> = { [K in keyof T]: T[K] } & {}

type SelectionExpression<TField> = Extract<TField, AnyExpression>

type RequiredSelectionKeys<TSelection extends SelectionObject> = {
  [K in keyof TSelection]-?: [SelectionExpression<TSelection[K]>] extends [
    never,
  ]
    ? never
    : Omit extends TSelection[K]
      ? never
      : K
}[keyof TSelection]

type OptionalSelectionKeys<TSelection extends SelectionObject> = {
  [K in keyof TSelection]-?: [SelectionExpression<TSelection[K]>] extends [
    never,
  ]
    ? never
    : Omit extends TSelection[K]
      ? K
      : never
}[keyof TSelection]

type SelectionFieldOutput<TField, TNullableSources> =
  SelectionExpression<TField> extends infer TExpression extends AnyExpression
    ? NullableOutput<
        import('../expressions/types.ts').ExpressionOutput<TExpression>,
        TExpression,
        TNullableSources
      >
    : never

export type SelectionOutput<
  TSelection,
  TNullableSources = never,
> = TSelection extends SelectionObject
  ? Simplify<
      {
        -readonly [K in RequiredSelectionKeys<TSelection>]: SelectionFieldOutput<
          TSelection[K],
          TNullableSources
        >
      } & {
        -readonly [K in OptionalSelectionKeys<TSelection>]?: SelectionFieldOutput<
          TSelection[K],
          TNullableSources
        >
      }
    >
  : never

export type SelectionRequires<TSelection> = RequiresOf<
  SelectionItems<TSelection>
>
export type SelectionMetadata<TSelection> = InheritedMetadata<
  SelectionItems<TSelection>
>

/** SQL result domains retained for each named projection field. */
export type SelectionSqlTypes<
  TSelection,
  TRow extends object = SelectionOutput<TSelection>,
> = {
  readonly [K in keyof TRow]: K extends keyof TSelection
    ? import('../core/fragment.ts').SqlTypeOf<TSelection[K]>
    : import('../core/sql-types.ts').SqlUnknown
}

/** Build the runtime field metadata for a named projection. */
export function selectionResultShape(selection: Selection): ResultShape {
  return createResultShape(
    Object.entries(selection)
      .filter(([, expression]) => expression !== omit)
      .map(([name, expression]) => ({
        name,
        ...resultValueOf(expression),
      }))
  )
}
