import { assertDialectCapability } from '../core/dialect.ts'
import type {
  DependenciesOf,
  ExpressionMeta,
  InheritedMetadata,
  RequiresCapabilityMeta,
  ResultMeta,
} from '../core/fragment.ts'
import {
  makeSchemaExpression,
  type AnyExpression,
  type SchemaExpression,
} from './types.ts'
import { queryValidationError } from '../query/errors.ts'

/** One safely encoded object key or zero-based array index in a JSON path. */
export type JsonPathSegment = string | number

const jsonPathBrand: unique symbol = Symbol('json-path')

/** An opaque root-relative JSON path whose literal segments remain available to TypeScript. */
export interface JsonPath<
  TSegments extends readonly JsonPathSegment[] = readonly JsonPathSegment[],
> {
  readonly [jsonPathBrand]: true
  readonly pathKind: 'json'
  readonly segments: TSegments
}

/**
 * Build a root-relative JSON path from object keys and array indexes.
 *
 * @throws {TypeError} When an index is negative, fractional, or unsafe.
 */
export function jsonPath<const TSegments extends readonly JsonPathSegment[]>(
  ...segments: TSegments
): JsonPath<TSegments> {
  for (const [index, segment] of segments.entries()) {
    if (
      typeof segment === 'number' &&
      (!Number.isSafeInteger(segment) || segment < 0)
    ) {
      throw queryValidationError({
        code: 'invalid-json-path',
        context: 'expression.json-path',
        path: ['jsonPath', index],
        message: 'JSON path indexes must be non-negative safe integers',
        hint: 'Use a non-negative safe integer for each JSON array index.',
      })
    }
  }

  return Object.freeze({
    [jsonPathBrand]: true as const,
    pathKind: 'json' as const,
    segments: Object.freeze([...segments]) as unknown as TSegments,
  })
}

type JsonExpressionMetadata<TOutput, TDocument> =
  | ResultMeta<TOutput>
  | ExpressionMeta<DependenciesOf<TDocument>>
  | InheritedMetadata<TDocument>
  | RequiresCapabilityMeta<'json'>

function jsonScalar<
  TOutput,
  TDocument extends AnyExpression,
  TPath extends JsonPath,
>(document: TDocument, path: TPath, kind: 'text' | 'number' | 'boolean') {
  return makeSchemaExpression<
    JsonExpressionMetadata<TOutput | null, TDocument>,
    'function'
  >('function', context => {
    assertDialectCapability(context.dialect, 'json')
    if (!context.dialect.json) {
      throw new Error(
        `Dialect "${context.dialect.name}" advertises JSON support without a JSON renderer`
      )
    }
    context.dialect.json.renderScalar(context, document, path.segments, kind)
  }) as SchemaExpression<
    JsonExpressionMetadata<TOutput | null, TDocument>,
    'function'
  >
}

/** Extract a JSON string, returning SQL NULL for missing, null, or non-string values. */
export function jsonText<
  TDocument extends AnyExpression,
  TPath extends JsonPath,
>(document: TDocument, path: TPath) {
  return jsonScalar<string, TDocument, TPath>(document, path, 'text')
}

/** Extract a JSON number, returning SQL NULL for missing, null, or non-number values. */
export function jsonNumber<
  TDocument extends AnyExpression,
  TPath extends JsonPath,
>(document: TDocument, path: TPath) {
  return jsonScalar<number, TDocument, TPath>(document, path, 'number')
}

/** Extract a JSON boolean, returning SQL NULL for missing, null, or non-boolean values. */
export function jsonBoolean<
  TDocument extends AnyExpression,
  TPath extends JsonPath,
>(document: TDocument, path: TPath) {
  return jsonScalar<boolean, TDocument, TPath>(document, path, 'boolean')
}

/** Test whether a path exists, including when its value is JSON null. */
export function jsonExists<
  TDocument extends AnyExpression,
  TPath extends JsonPath,
>(document: TDocument, path: TPath) {
  return makeSchemaExpression<
    JsonExpressionMetadata<boolean, TDocument>,
    'function'
  >('function', context => {
    assertDialectCapability(context.dialect, 'json')
    if (!context.dialect.json) {
      throw new Error(
        `Dialect "${context.dialect.name}" advertises JSON support without a JSON renderer`
      )
    }
    context.dialect.json.renderExists(context, document, path.segments)
  }) as SchemaExpression<JsonExpressionMetadata<boolean, TDocument>, 'function'>
}
