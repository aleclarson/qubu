import type { AnyFragment, RenderContext } from './fragment.ts'
import type { QueryKind } from '../query/types.ts'

/** Capabilities whose syntax must be explicitly supported by a dialect. */
export type DialectCapability = 'ilike' | 'json' | 'on-conflict' | 'row-locking'

/**
 * Optional dialect hook used by schema expressions when a JavaScript value
 * must become SQL text instead of a query parameter.
 *
 * The hook is deliberately separate from {@link Dialect.placeholder}: schema
 * metadata is parameter-free and must never render a query placeholder.
 */
export type SchemaLiteralRenderer = (value: unknown) => string

/** Scalar application types supported by the portable JSON renderer. */
export type JsonScalarKind = 'text' | 'number' | 'boolean'

/** Dialect policy for portable scalar JSON reads and path existence checks. */
export interface DialectJson {
  renderScalar(
    context: RenderContext,
    document: AnyFragment,
    path: readonly (string | number)[],
    kind: JsonScalarKind
  ): void
  renderExists(
    context: RenderContext,
    document: AnyFragment,
    path: readonly (string | number)[]
  ): void
}

export type PaginationKind = 'offset' | 'fetch'

/** Logical built-in targets that a dialect can spell in CAST expressions. */
export type PortableCastType =
  | 'integer'
  | 'decimal'
  | 'text'
  | 'boolean'
  | 'date'
  | 'timestamp'
  | 'uuid'
  | 'json'
  | 'bigint'
  | 'binary'

/** A logical cast target whose concrete spelling is selected by a dialect. */
export interface PortableCastTarget<
  TType extends PortableCastType = PortableCastType,
> {
  readonly kind: 'portable-cast'
  readonly type: TType
}

/** A trusted raw cast target supplied by a custom definition. */
export interface NamedCastTarget<TTypeName extends string = string> {
  readonly kind: 'named-cast'
  readonly typeName: TTypeName
}

/** Runtime target carried by a definition that can be used with cast(). */
export type CastTarget = PortableCastTarget | NamedCastTarget

/** Dialect-specific spellings for built-in logical CAST targets. */
export type DialectCastTypes = Readonly<
  Partial<Record<PortableCastType, string>>
>

export interface PaginationPart {
  readonly kind: PaginationKind
  readonly rows: number
  readonly direction?: 'FIRST' | 'NEXT'
}

export interface DialectPagination {
  /** Render a complete pagination group in dialect-specific syntax. */
  readonly render: (
    context: RenderContext,
    parts: readonly PaginationPart[]
  ) => void
}

export type RowLockMode = 'update' | 'no-key-update' | 'share' | 'key-share'

export type RowLockWaitPolicy = 'default' | 'nowait' | 'skip-locked'

export interface DialectRowLocking {
  /** Render a dialect-supported row-locking clause. */
  readonly render: (
    context: RenderContext,
    mode: RowLockMode,
    wait: RowLockWaitPolicy
  ) => void
}

/** Output modes accepted by first-party EXPLAIN policies. */
export type ExplainFormat =
  | 'text'
  | 'json'
  | 'xml'
  | 'yaml'
  | 'tree'
  | 'traditional'
  | 'query-plan'
  | 'bytecode'

/** Dialect-independent EXPLAIN switches passed to a dialect policy. */
export interface ExplainRenderOptions {
  readonly analyze?: boolean
  readonly verbose?: boolean
  readonly buffers?: boolean
  readonly format?: ExplainFormat
  /** SQLite's high-level query-plan mode when true, bytecode when false. */
  readonly queryPlan?: boolean
}

/** Dialect policy for wrapping one rendered query in EXPLAIN syntax. */
export interface DialectExplain {
  readonly render: (
    statement: string,
    queryKind: QueryKind,
    options: ExplainRenderOptions
  ) => string
}

export interface Dialect<
  TCapabilities extends DialectCapability = DialectCapability,
> {
  readonly name: string
  quoteIdentifier(identifier: string): string
  placeholder(position: number): string
  readonly pagination?: DialectPagination
  /** Rendering policy for the typed SELECT row-locking clause. */
  readonly rowLocking?: DialectRowLocking
  /** Rendering policy for Qubu's portable JSON operations. */
  readonly json?: DialectJson
  /** Overrides for the standard spelling of logical CAST targets. */
  readonly castTypes?: DialectCastTypes
  /** Optional SQL literal policy used by deterministic schema expressions. */
  readonly renderSchemaLiteral?: SchemaLiteralRenderer
  /** Optional policy for dialect-specific EXPLAIN syntax and options. */
  readonly explain?: DialectExplain
  /** Capabilities advertised by this dialect at the rendering boundary. */
  readonly capabilities?: readonly TCapabilities[]
}

export interface DialectOptions<
  TCapabilities extends Exclude<DialectCapability, 'json'> = never,
  TJson extends DialectJson | undefined = DialectJson | undefined,
> {
  readonly name: string
  readonly quoteIdentifier?: (identifier: string) => string
  readonly placeholder: (position: number) => string
  readonly pagination?: DialectPagination
  /** Rendering policy for the typed SELECT row-locking clause. */
  readonly rowLocking?: DialectRowLocking
  readonly json?: TJson
  /** Overrides for the standard spelling of logical CAST targets. */
  readonly castTypes?: DialectCastTypes
  /** Optional SQL literal policy used by deterministic schema expressions. */
  readonly renderSchemaLiteral?: SchemaLiteralRenderer
  /** Optional policy for dialect-specific EXPLAIN syntax and options. */
  readonly explain?: DialectExplain
  readonly capabilities?: readonly TCapabilities[]
}

const standardCastTypes: Readonly<Record<PortableCastType, string>> = {
  integer: 'INTEGER',
  decimal: 'DECIMAL',
  text: 'TEXT',
  boolean: 'BOOLEAN',
  date: 'DATE',
  timestamp: 'TIMESTAMP',
  uuid: 'UUID',
  json: 'JSON',
  bigint: 'BIGINT',
  binary: 'VARBINARY',
}

/** Resolve a logical or explicitly named CAST target for a dialect. */
export function resolveCastTarget(
  dialect: Dialect,
  target: CastTarget
): string {
  if (target.kind === 'named-cast') return target.typeName
  return dialect.castTypes?.[target.type] ?? standardCastTypes[target.type]
}

const quoteIdentifier = (identifier: string) =>
  `"${identifier.replaceAll('"', '""')}` + '"'

/**
 * Create a dialect from the few rendering decisions that SQL builders need
 * to leave open. More involved syntax can be supplied as a custom fragment.
 */
export function createDialect<
  const TCapabilities extends Exclude<DialectCapability, 'json'> = never,
>(
  options: DialectOptions<TCapabilities, DialectJson> & {
    readonly json: DialectJson
  }
): Dialect<TCapabilities | 'json'>
export function createDialect<
  const TCapabilities extends Exclude<DialectCapability, 'json'> = never,
>(options: DialectOptions<TCapabilities, undefined>): Dialect<TCapabilities>
export function createDialect(
  options: DialectOptions<Exclude<DialectCapability, 'json'>>
): Dialect {
  return Object.freeze({
    name: options.name,
    quoteIdentifier: options.quoteIdentifier ?? quoteIdentifier,
    placeholder: options.placeholder,
    pagination: options.pagination,
    rowLocking: options.rowLocking,
    json: options.json,
    castTypes: options.castTypes
      ? Object.freeze({ ...options.castTypes })
      : undefined,
    renderSchemaLiteral: options.renderSchemaLiteral,
    explain: options.explain,
    capabilities: Object.freeze([
      ...(options.capabilities ?? []),
      ...(options.json ? (['json'] as const) : []),
    ]),
  }) as Dialect
}

/**
 * Check a capability at runtime for callers that intentionally bypass the
 * typed render boundary or use a dialect supplied by an older integration.
 */
export function assertDialectCapability(
  dialect: Dialect,
  capability: DialectCapability
): void {
  if (dialect.capabilities?.includes(capability)) return

  throw new Error(
    `Dialect "${dialect.name}" does not support the "${capability}" capability`
  )
}
