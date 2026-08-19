import type { Dialect } from '../core/dialect.ts'
import type { AnyFragment, RenderContext } from '../core/fragment.ts'
import { isColumnReference } from '../expressions/column.ts'
import {
  type AnyExpression,
  type AnySchemaExpression,
  type ExpressionKind,
  isSchemaExpression,
  makeSchemaExpression,
  markSchemaExpression,
  type SchemaExpression,
} from '../expressions/types.ts'
import { isValueExpression } from '../expressions/value.ts'
import { standardDialect } from '../dialects/standard.ts'

/** SQL declaration context in which a schema expression will be emitted. */
export type SchemaExpressionMode = 'default' | 'generated' | 'check' | 'index'

/** Stable error categories for schema-expression validation failures. */
export type SchemaExpressionErrorCode =
  | 'not-deterministic'
  | 'unsupported-expression'
  | 'parameter'
  | 'unsupported-value'
  | 'column-not-allowed'
  | 'dialect-mismatch'
  | 'invalid-literal'

/** Error raised before a schema expression can become persisted SQL. */
export class SchemaExpressionError extends TypeError {
  readonly code: SchemaExpressionErrorCode
  readonly mode?: SchemaExpressionMode

  constructor(
    code: SchemaExpressionErrorCode,
    message: string,
    mode?: SchemaExpressionMode
  ) {
    super(message)
    this.name = 'SchemaExpressionError'
    this.code = code
    this.mode = mode
  }
}

/**
 * Restricted rendering surface made available to explicit schema extensions.
 * `parameter()` is retained for structural compatibility with query
 * renderers, but always throws; use `literal()` for deterministic values.
 */
export interface SchemaRenderContext extends RenderContext {
  readonly schemaMode: SchemaExpressionMode
  literal(value: unknown): void
  readonly renderColumnReference: (columnName: string) => void
}

/** Result of schema rendering. The parameter list is always empty. */
export interface RenderedSchemaExpression {
  readonly text: string
  readonly parameters: readonly []
}

/** Options for rendering a branded schema expression. */
export interface SchemaRenderOptions {
  readonly mode: SchemaExpressionMode
  readonly dialect?: Dialect
}

/** Compile-time gate used by schema renderers to reject ordinary query ASTs. */
export type SchemaExpressionInput<TExpression extends AnyExpression> =
  TExpression extends AnySchemaExpression
    ? TExpression
    : TExpression & {
        readonly __requires_deterministic_schema_expression__: never
      }

/** A dialect-tagged raw SQL expression for syntax Qubu does not model. */
export interface UnsafeSchemaSqlExpression
  extends SchemaExpression<never, 'unsafe'> {
  readonly schemaSqlDialect: string
  readonly schemaSql: string
}

/**
 * Normalize only line endings. Whitespace, quoting, and every other byte of
 * a raw schema expression remain under the extension author's control.
 */
export function normalizeSchemaSql(sql: string): string {
  return sql.replace(/\r\n?/g, '\n')
}

/**
 * Explicitly opt an audited expression into deterministic schema rendering.
 * The wrapper does not rewrite the renderer; it records the author's promise
 * so schema consumers can reject ordinary query extensions by default.
 */
export function schemaExpression<TExpression extends AnyExpression>(
  expression: TExpression
): SchemaExpression<
  import('../core/fragment.ts').MetadataOf<TExpression>,
  TExpression['expressionKind']
>
export function schemaExpression(
  expression: AnyExpression
): AnySchemaExpression {
  return markSchemaExpression(expression)
}

/**
 * Define an extension with the restricted schema context. This is the typed
 * alternative to {@link unsafeSchemaSql} for deterministic custom syntax.
 */
export function defineSchemaExpression<
  TMetadata = never,
  TKind extends ExpressionKind = 'function',
>(
  kind: TKind,
  render: (context: SchemaRenderContext) => void
): SchemaExpression<TMetadata, TKind> {
  return makeSchemaExpression<TMetadata, TKind>(kind, context =>
    render(context as SchemaRenderContext)
  )
}

/**
 * Create a dialect-specific raw schema expression. The SQL is parameter-free
 * by contract and is preserved exactly apart from CRLF/CR line-ending
 * normalization.
 */
export function unsafeSchemaSql(
  dialect: string,
  sql: string
): UnsafeSchemaSqlExpression
export function unsafeSchemaSql(options: {
  readonly dialect: string
  readonly sql: string
}): UnsafeSchemaSqlExpression
export function unsafeSchemaSql(
  dialectOrOptions: string | { readonly dialect: string; readonly sql: string },
  sql?: string
): UnsafeSchemaSqlExpression {
  const dialect =
    typeof dialectOrOptions === 'string'
      ? dialectOrOptions
      : dialectOrOptions.dialect
  const source =
    typeof dialectOrOptions === 'string' ? sql : dialectOrOptions.sql

  if (!dialect) {
    throw new TypeError('unsafeSchemaSql() requires a dialect tag')
  }
  if (source === undefined) {
    throw new TypeError('unsafeSchemaSql() requires SQL text')
  }

  const normalized = normalizeSchemaSql(source)
  const expression = makeSchemaExpression<never, 'unsafe'>('unsafe', context =>
    context.append(normalized)
  )

  return Object.freeze({
    ...expression,
    schemaSqlDialect: dialect,
    schemaSql: normalized,
  })
}

/** Identify a dialect-tagged raw schema expression. */
export function isUnsafeSchemaSql(
  value: unknown
): value is UnsafeSchemaSqlExpression {
  return (
    isSchemaExpression(value) &&
    value.expressionKind === 'unsafe' &&
    typeof (value as Partial<UnsafeSchemaSqlExpression>).schemaSqlDialect ===
      'string' &&
    typeof (value as Partial<UnsafeSchemaSqlExpression>).schemaSql === 'string'
  )
}

/** Render a schema expression without ever creating query parameters. */
export function renderSchemaExpression<TExpression extends AnyExpression>(
  expression: SchemaExpressionInput<TExpression>,
  options: SchemaRenderOptions
): RenderedSchemaExpression
export function renderSchemaExpression<TExpression extends AnyExpression>(
  expression: SchemaExpressionInput<TExpression>,
  mode: SchemaExpressionMode,
  dialect?: Dialect
): RenderedSchemaExpression
export function renderSchemaExpression(
  expression: AnyExpression,
  optionsOrMode: SchemaRenderOptions | SchemaExpressionMode,
  dialectOption?: Dialect
): RenderedSchemaExpression {
  const options =
    typeof optionsOrMode === 'string'
      ? { mode: optionsOrMode, dialect: dialectOption }
      : optionsOrMode
  const dialect = options.dialect ?? standardDialect()

  if (!isSchemaExpression(expression)) {
    throw new SchemaExpressionError(
      'not-deterministic',
      'Only branded deterministic expressions can be rendered as schema SQL',
      options.mode
    )
  }

  assertSupportedExpression(expression, options.mode)

  let text = ''
  const context: SchemaRenderContext = {
    dialect,
    projectionMode: 'result',
    schemaMode: options.mode,
    append(value) {
      text += value
    },
    parameter() {
      throw new SchemaExpressionError(
        'parameter',
        'Schema expressions cannot render query parameters',
        options.mode
      )
    },
    literal(value) {
      text += renderSchemaLiteral(dialect, value, options.mode)
    },
    renderColumnReference(columnName) {
      if (options.mode === 'default') {
        throw new SchemaExpressionError(
          'column-not-allowed',
          'Default expressions cannot reference table columns',
          options.mode
        )
      }
      text += dialect.quoteIdentifier(columnName)
    },
    render(part) {
      renderSchemaPart(context, part, options.mode)
    },
    renderRelation() {
      throw new SchemaExpressionError(
        'unsupported-expression',
        'Schema expressions cannot contain subqueries',
        options.mode
      )
    },
  }

  renderSchemaPart(context, expression, options.mode)

  return Object.freeze({
    text,
    parameters: Object.freeze([]) as readonly [],
  })
}

/** Convenience form for callers that only need the SQL text. */
export function renderSchemaSql<TExpression extends AnyExpression>(
  expression: SchemaExpressionInput<TExpression>,
  options: SchemaRenderOptions
): string {
  return renderSchemaExpression(expression, options).text
}

function renderSchemaPart(
  context: SchemaRenderContext,
  part: AnyFragment,
  mode: SchemaExpressionMode
): void {
  if (isValueExpression(part)) {
    context.literal(part.value)
    return
  }
  if (isColumnReference(part)) {
    context.renderColumnReference(part.columnName)
    return
  }
  if (isUnsafeSchemaSql(part)) {
    if (part.schemaSqlDialect !== context.dialect.name) {
      throw new SchemaExpressionError(
        'dialect-mismatch',
        `Schema SQL is tagged for "${part.schemaSqlDialect}" but rendered for "${context.dialect.name}"`,
        mode
      )
    }
    context.append(part.schemaSql)
    return
  }
  if (!isSchemaExpression(part)) {
    throw new SchemaExpressionError(
      'not-deterministic',
      'Schema expressions may only compose branded expressions, columns, and literals',
      mode
    )
  }
  assertSupportedExpression(part, mode)
  part.render(context)
}

function assertSupportedExpression(
  expression: AnySchemaExpression,
  mode: SchemaExpressionMode
): void {
  if (
    expression.expressionKind === 'subquery' ||
    (expression as { readonly expressionCategory?: string }).expressionCategory
  ) {
    throw new SchemaExpressionError(
      'unsupported-expression',
      'Aggregates, windows, and subqueries are not valid schema expressions',
      mode
    )
  }
}

function renderSchemaLiteral(
  dialect: Dialect,
  value: unknown,
  mode: SchemaExpressionMode
): string {
  if (dialect.renderSchemaLiteral) {
    const rendered = dialect.renderSchemaLiteral(value)
    if (typeof rendered !== 'string' || rendered.includes('?')) {
      throw new SchemaExpressionError(
        'invalid-literal',
        'A schema literal renderer must return parameter-free SQL text',
        mode
      )
    }
    return rendered
  }

  if (value === null) return 'NULL'
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (typeof value === 'string') return `'${value.replaceAll("'", "''")}'`
  if (typeof value === 'bigint') return String(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new SchemaExpressionError(
        'unsupported-value',
        'Schema literals require finite numbers',
        mode
      )
    }
    return Object.is(value, -0) ? '0' : String(value)
  }

  throw new SchemaExpressionError(
    'unsupported-value',
    `Unsupported schema literal type: ${value === undefined ? 'undefined' : typeof value}`,
    mode
  )
}
