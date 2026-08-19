import type {
  AnySchemaExpression,
  SchemaExpression,
} from '../expressions/types.ts'
import { isSchemaExpression } from '../expressions/types.ts'

/** Values that can be represented without a dialect-specific SQL renderer. */
export type SchemaLiteralValue = null | boolean | string | number | bigint

/** A canonical, dialect-neutral literal node retained by default metadata. */
export type CanonicalLiteral =
  | { readonly kind: 'null' }
  | { readonly kind: 'boolean'; readonly value: boolean }
  | { readonly kind: 'string'; readonly value: string }
  | { readonly kind: 'number'; readonly value: string }
  | { readonly kind: 'bigint'; readonly value: string }

/** A default represented by a canonical literal node. */
export interface LiteralDefaultDescriptor<
  TLiteral extends CanonicalLiteral = CanonicalLiteral,
> {
  readonly kind: 'literal'
  readonly value: TLiteral
}

/** A default whose SQL is retained as a deterministic schema expression. */
export interface ExpressionDefaultDescriptor<
  TExpression extends AnySchemaExpression = AnySchemaExpression,
> {
  readonly kind: 'expression'
  readonly expression: TExpression
}

/** A default supplied by the database or another external schema authority. */
export interface ExternalDefaultDescriptor {
  readonly kind: 'external'
}

/** Complete default metadata carried by a column definition. */
export type ColumnDefault =
  | LiteralDefaultDescriptor
  | ExpressionDefaultDescriptor
  | ExternalDefaultDescriptor

/** Alias used by snapshot and schema tooling consumers. */
export type DefaultDescriptor = ColumnDefault

/** Storage mode for a generated-column expression. */
export type GeneratedColumnMode = 'stored' | 'virtual'

/** A generated column with an expression that can be rendered later. */
export interface ExpressionGeneratedColumnDescriptor<
  TExpression extends AnySchemaExpression = AnySchemaExpression,
> {
  readonly kind: 'expression'
  readonly expression: TExpression
  readonly mode: GeneratedColumnMode
}

/** A generated-column behavior known to exist but owned externally. */
export interface ExternalGeneratedColumnDescriptor {
  readonly kind: 'external'
}

/** Complete generated-column metadata, separate from identity metadata. */
export type GeneratedColumnDescriptor =
  | ExpressionGeneratedColumnDescriptor
  | ExternalGeneratedColumnDescriptor

/** Alias used by snapshot and schema tooling consumers. */
export type GeneratedDescriptor = GeneratedColumnDescriptor

/** Identity generation policy. Identity is not an ordinary SQL expression. */
export type IdentityGeneration = 'always' | 'by-default'

/** Complete identity metadata for a database-generated column value. */
export interface IdentityDescriptor {
  readonly kind: 'identity'
  readonly generation: IdentityGeneration
}

/** Structured failures raised while resolving column behavior metadata. */
export type ColumnBehaviorErrorCode =
  | 'invalid-default'
  | 'invalid-generated-column'
  | 'invalid-identity'
  | 'default-flag-conflict'
  | 'generated-flag-conflict'
  | 'default-generated-conflict'
  | 'identity-generated-conflict'

/** A column behavior error with a stable code and optional property path. */
export class ColumnBehaviorError extends TypeError {
  readonly code: ColumnBehaviorErrorCode
  readonly path?: string

  constructor(code: ColumnBehaviorErrorCode, message: string, path?: string) {
    super(message)
    this.name = 'ColumnBehaviorError'
    this.code = code
    this.path = path
  }
}

/** Build a canonical literal node from a supported JavaScript scalar. */
export function canonicalLiteral(value: SchemaLiteralValue): CanonicalLiteral {
  if (value === null) return Object.freeze({ kind: 'null' as const })
  if (typeof value === 'boolean') {
    return Object.freeze({ kind: 'boolean' as const, value })
  }
  if (typeof value === 'string') {
    return Object.freeze({ kind: 'string' as const, value })
  }
  if (typeof value === 'bigint') {
    return Object.freeze({ kind: 'bigint' as const, value: String(value) })
  }
  if (!Number.isFinite(value)) {
    throw new ColumnBehaviorError(
      'invalid-default',
      'Default literal numbers must be finite',
      'default.value'
    )
  }
  return Object.freeze({
    kind: 'number' as const,
    value: Object.is(value, -0) ? '0' : String(value),
  })
}

/** Create an immutable literal default descriptor. */
export function defaultLiteral<const TValue extends SchemaLiteralValue>(
  value: TValue
): LiteralDefaultDescriptor {
  return Object.freeze({
    kind: 'literal' as const,
    value: canonicalLiteral(value),
  })
}

/** Create an immutable expression-backed default descriptor. */
export function defaultExpression<
  const TExpression extends AnySchemaExpression,
>(expression: TExpression): ExpressionDefaultDescriptor<TExpression> {
  assertSchemaExpression(expression, 'default.expression')
  return Object.freeze({ kind: 'expression' as const, expression })
}

/** Mark a legacy or externally managed database default explicitly. */
export function externalDefault(): ExternalDefaultDescriptor {
  return Object.freeze({ kind: 'external' as const })
}

/** Create an immutable generated-column descriptor. */
export function generatedColumn<const TExpression extends AnySchemaExpression>(
  expression: TExpression,
  mode?: GeneratedColumnMode | { readonly mode: GeneratedColumnMode }
): ExpressionGeneratedColumnDescriptor<TExpression> {
  assertSchemaExpression(
    expression,
    'generatedColumn.expression',
    'invalid-generated-column'
  )
  const resolvedMode =
    typeof mode === 'string' ? mode : (mode?.mode ?? 'stored')
  if (resolvedMode !== 'stored' && resolvedMode !== 'virtual') {
    throw new ColumnBehaviorError(
      'invalid-generated-column',
      `Generated-column mode must be "stored" or "virtual", received "${String(resolvedMode)}"`,
      'generatedColumn.mode'
    )
  }
  return Object.freeze({
    kind: 'expression' as const,
    expression,
    mode: resolvedMode,
  })
}

/** Mark a legacy or externally managed generated column explicitly. */
export function externalGeneratedColumn(): ExternalGeneratedColumnDescriptor {
  return Object.freeze({ kind: 'external' as const })
}

/** Describe a database identity column without inventing a generated SQL expression. */
export function identityColumn(
  generation: IdentityGeneration = 'by-default'
): IdentityDescriptor {
  if (generation !== 'always' && generation !== 'by-default') {
    throw new ColumnBehaviorError(
      'invalid-identity',
      `Identity generation must be "always" or "by-default", received "${String(generation)}"`,
      'identity.generation'
    )
  }
  return Object.freeze({ kind: 'identity' as const, generation })
}

/** The normalized behavior fields attached to a column definition. */
export interface ResolvedColumnBehavior {
  readonly hasDefault: boolean
  readonly generated: boolean
  readonly default?: ColumnDefault
  readonly generatedColumn?: GeneratedColumnDescriptor
  readonly identity?: IdentityDescriptor
}

/** Normalize complete and legacy column behavior into immutable metadata. */
export function resolveColumnBehavior(options: {
  readonly hasDefault?: boolean
  readonly generated?: boolean
  readonly default?: ColumnDefault
  readonly generatedColumn?: GeneratedColumnDescriptor
  readonly identity?: IdentityDescriptor
}): ResolvedColumnBehavior {
  const hasDefaultFlag = options.hasDefault === true
  const generatedFlag = options.generated === true
  const defaultDescriptor = options.default
  const generatedDescriptor = options.generatedColumn
  const identityDescriptor = options.identity

  if (defaultDescriptor !== undefined) {
    assertDefaultDescriptor(defaultDescriptor)
    if (options.hasDefault === false) {
      throw new ColumnBehaviorError(
        'default-flag-conflict',
        'A complete default descriptor cannot be combined with hasDefault: false',
        'hasDefault'
      )
    }
    if (generatedDescriptor !== undefined || identityDescriptor !== undefined) {
      throw new ColumnBehaviorError(
        'default-generated-conflict',
        'A column cannot declare a complete default together with generated-column or identity metadata',
        'default'
      )
    }
    if (generatedFlag) {
      throw new ColumnBehaviorError(
        'default-generated-conflict',
        'A complete default descriptor cannot be combined with generated: true',
        'default'
      )
    }
  }

  if (generatedDescriptor !== undefined) {
    assertGeneratedColumnDescriptor(generatedDescriptor)
    if (options.generated === false) {
      throw new ColumnBehaviorError(
        'generated-flag-conflict',
        'A complete generated-column descriptor cannot be combined with generated: false',
        'generated'
      )
    }
    if (identityDescriptor !== undefined) {
      throw new ColumnBehaviorError(
        'identity-generated-conflict',
        'A column cannot declare both generated-column and identity metadata',
        'generatedColumn'
      )
    }
    if (hasDefaultFlag) {
      throw new ColumnBehaviorError(
        'default-generated-conflict',
        'A complete generated-column descriptor cannot be combined with hasDefault: true',
        'generatedColumn'
      )
    }
  }

  if (identityDescriptor !== undefined) {
    assertIdentityDescriptor(identityDescriptor)
    if (options.generated === false) {
      throw new ColumnBehaviorError(
        'generated-flag-conflict',
        'Identity metadata cannot be combined with generated: false',
        'generated'
      )
    }
    if (hasDefaultFlag) {
      throw new ColumnBehaviorError(
        'identity-generated-conflict',
        'Identity metadata cannot be combined with hasDefault: true',
        'identity'
      )
    }
  }

  const normalizedDefault =
    defaultDescriptor === undefined
      ? undefined
      : freezeDefaultDescriptor(defaultDescriptor)
  const normalizedGenerated =
    generatedDescriptor === undefined
      ? undefined
      : freezeGeneratedColumnDescriptor(generatedDescriptor)
  const normalizedIdentity =
    identityDescriptor === undefined
      ? undefined
      : freezeIdentityDescriptor(identityDescriptor)

  return Object.freeze({
    hasDefault: hasDefaultFlag || normalizedDefault !== undefined,
    generated:
      generatedFlag ||
      normalizedGenerated !== undefined ||
      normalizedIdentity !== undefined,
    default:
      normalizedDefault ?? (hasDefaultFlag ? externalDefault() : undefined),
    generatedColumn:
      normalizedGenerated ??
      (generatedFlag && normalizedIdentity === undefined
        ? externalGeneratedColumn()
        : undefined),
    identity: normalizedIdentity,
  })
}

function freezeDefaultDescriptor(value: ColumnDefault): ColumnDefault {
  if (value.kind === 'external') return externalDefault()
  if (value.kind === 'expression') {
    return Object.freeze({
      kind: 'expression' as const,
      expression: value.expression,
    })
  }
  return Object.freeze({
    kind: 'literal' as const,
    value: Object.freeze({ ...value.value }),
  }) as ColumnDefault
}

function freezeGeneratedColumnDescriptor(
  value: GeneratedColumnDescriptor
): GeneratedColumnDescriptor {
  if (value.kind === 'external') return externalGeneratedColumn()
  return Object.freeze({
    kind: 'expression' as const,
    expression: value.expression,
    mode: value.mode,
  })
}

function freezeIdentityDescriptor(
  value: IdentityDescriptor
): IdentityDescriptor {
  return Object.freeze({
    kind: 'identity' as const,
    generation: value.generation,
  })
}

function assertSchemaExpression(
  expression: unknown,
  path: string,
  code: 'invalid-default' | 'invalid-generated-column' = 'invalid-default'
): asserts expression is SchemaExpression {
  if (!isSchemaExpression(expression)) {
    throw new ColumnBehaviorError(
      code,
      'Schema behavior expressions must carry the deterministic schema-expression brand',
      path
    )
  }
}

function assertDefaultDescriptor(value: ColumnDefault): void {
  if (!value || typeof value !== 'object') {
    throw new ColumnBehaviorError(
      'invalid-default',
      'Column default metadata must be an object',
      'default'
    )
  }
  if (value.kind === 'external') return
  if (value.kind === 'expression') {
    assertSchemaExpression(value.expression, 'default.expression')
    return
  }
  if (value.kind === 'literal') {
    assertCanonicalLiteral(value.value)
    return
  }
  throw new ColumnBehaviorError(
    'invalid-default',
    'Unknown column default descriptor kind',
    'default.kind'
  )
}

function assertGeneratedColumnDescriptor(
  value: GeneratedColumnDescriptor
): void {
  if (!value || typeof value !== 'object') {
    throw new ColumnBehaviorError(
      'invalid-generated-column',
      'Generated-column metadata must be an object',
      'generatedColumn'
    )
  }
  if (value.kind === 'external') return
  if (value.kind === 'expression') {
    assertSchemaExpression(
      value.expression,
      'generatedColumn.expression',
      'invalid-generated-column'
    )
    if (value.mode !== 'stored' && value.mode !== 'virtual') {
      throw new ColumnBehaviorError(
        'invalid-generated-column',
        'Generated-column mode must be "stored" or "virtual"',
        'generatedColumn.mode'
      )
    }
    return
  }
  throw new ColumnBehaviorError(
    'invalid-generated-column',
    'Unknown generated-column descriptor kind',
    'generatedColumn.kind'
  )
}

function assertIdentityDescriptor(value: IdentityDescriptor): void {
  if (
    !value ||
    typeof value !== 'object' ||
    value.kind !== 'identity' ||
    (value.generation !== 'always' && value.generation !== 'by-default')
  ) {
    throw new ColumnBehaviorError(
      'invalid-identity',
      'Identity metadata must use generation "always" or "by-default"',
      'identity.generation'
    )
  }
}

function assertCanonicalLiteral(value: CanonicalLiteral): void {
  if (!value || typeof value !== 'object') {
    throw new ColumnBehaviorError(
      'invalid-default',
      'Literal defaults must contain a canonical literal node',
      'default.value'
    )
  }
  switch (value.kind) {
    case 'null':
      return
    case 'boolean':
      if (typeof value.value === 'boolean') return
      break
    case 'string':
      if (typeof value.value === 'string') return
      break
    case 'number':
      if (typeof value.value === 'string' && value.value.length > 0) return
      break
    case 'bigint':
      if (/^-?(0|[1-9][0-9]*)$/.test(value.value)) return
      break
  }
  throw new ColumnBehaviorError(
    'invalid-default',
    'Literal defaults must contain a valid canonical literal node',
    'default.value'
  )
}
