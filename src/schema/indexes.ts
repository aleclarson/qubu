import type { HasAggregate, HasSubquery, HasWindow, OutputOf } from "../core/fragment.ts"
import type { ColumnReference } from "../expressions/column.ts"
import type { AnyExpression, AnySchemaExpression } from "../expressions/types.ts"
import type { OrderTerm } from "../query/clauses/order-by.ts"
import type { DeclaredColumnNullabilityOf } from "./column-nullability.ts"
import type {
  SchemaDialectExtension,
  SchemaObjectIdentity,
  SchemaObjectNameOptions,
} from "./metadata.ts"
import type { SchemaLiteralValue } from "./column-behavior.ts"
import { dialectMismatchDiagnostic, freezeSchemaMetadata } from "./metadata.ts"

export type IndexTerm = AnyExpression | OrderTerm<any>

/** Additional physical facts attached to one index term. */
export interface IndexTermOptions {
  readonly prefixLength?: SchemaLiteralValue | AnySchemaExpression
  readonly operatorClass?: string
}

/** PostgreSQL-specific index method and storage metadata. */
export interface PostgresIndexExtension extends SchemaDialectExtension<"postgresql"> {
  readonly method?: "btree" | "hash" | "gist" | "spgist" | "gin" | "brin"
  readonly concurrently?: boolean
  readonly operatorClasses?: Readonly<Record<string, string>>
  readonly storageParameters?: Readonly<Record<string, string | number | boolean>>
}

/** SQLite-specific index metadata retained for a future adapter. */
export interface SqliteIndexExtension extends SchemaDialectExtension<"sqlite"> {
  readonly auto?: boolean
}

/** MySQL-specific index algorithm, locking, and parser metadata. */
export interface MysqlIndexExtension extends SchemaDialectExtension<"mysql"> {
  readonly algorithm?: "default" | "inplace" | "copy"
  readonly lock?: "default" | "none" | "shared" | "exclusive"
  readonly using?: "btree" | "hash" | "rtree"
  readonly parser?: string
  readonly keyBlockSize?: number
}

/** First-party and user-defined dialect extensions for indexes. */
export type IndexDialectExtension =
  | PostgresIndexExtension
  | SqliteIndexExtension
  | MysqlIndexExtension
  | (SchemaDialectExtension<string> & Readonly<Record<string, unknown>>)

export interface IndexOptions<
  TPredicate extends AnyExpression | undefined = AnyExpression | undefined,
  TExtension extends IndexDialectExtension | undefined = IndexDialectExtension | undefined,
> extends SchemaObjectNameOptions {
  readonly unique?: boolean
  readonly where?: TPredicate
  /** Columns stored in the index payload but not used as key terms. */
  readonly include?: readonly ColumnReference<string, any>[]
  /** Typed engine-specific index options. */
  readonly dialect?: TExtension
  /** Exact engine index method, when it is not dialect-extension data. */
  readonly method?: string
  /** Physical backing constraint name, when the engine exposes one. */
  readonly backingConstraint?: string
  /** Prefix lengths and operator classes aligned with the terms array. */
  readonly termOptions?: readonly (IndexTermOptions | undefined)[]
}

type IndexTermExpression<TTerm> = TTerm extends OrderTerm<any> ? TTerm["expression"] : TTerm

type IsNullableIndexColumn<TColumn> = [DeclaredColumnNullabilityOf<TColumn>] extends [never]
  ? null extends OutputOf<TColumn>
    ? true
    : false
  : true extends DeclaredColumnNullabilityOf<TColumn>
    ? true
    : false

type IsEligibleColumn<TTerm> =
  IndexTermExpression<TTerm> extends infer TExpression
    ? TExpression extends ColumnReference<string, any>
      ? IsNullableIndexColumn<TExpression> extends true
        ? false
        : true
      : false
    : false

type AllEligibleColumns<TTerms extends readonly IndexTerm[]> = {
  [K in keyof TTerms]: IsEligibleColumn<TTerms[K]>
}[number] extends infer TEligibility
  ? false extends TEligibility
    ? true extends TEligibility
      ? boolean
      : false
    : true
  : false

type BooleanOption<TValue> = [Extract<TValue, true>] extends [never]
  ? false
  : [Exclude<TValue, true>] extends [never]
    ? true
    : boolean

type UniqueOption<TOptions> = "unique" extends keyof TOptions
  ? BooleanOption<TOptions["unique"]>
  : false

type PredicateOption<TOptions> = "where" extends keyof TOptions ? TOptions["where"] : undefined

type DialectOption<TOptions> = TOptions extends {
  readonly dialect?: infer TDialect
}
  ? unknown extends TDialect
    ? IndexDialectExtension | undefined
    : TDialect
  : undefined

type PredicatePresence<TOptions> = [Exclude<PredicateOption<TOptions>, undefined>] extends [never]
  ? false
  : undefined extends PredicateOption<TOptions>
    ? boolean
    : true

type HasTermOptions<TOptions> = "termOptions" extends keyof TOptions ? true : false

type IsCandidateKey<TTerms extends readonly IndexTerm[], TOptions extends IndexOptions<any>> =
  HasTermOptions<TOptions> extends true
    ? false
    : UniqueOption<TOptions> extends false
      ? false
      : PredicatePresence<TOptions> extends true
        ? false
        : AllEligibleColumns<TTerms> extends false
          ? false
          : UniqueOption<TOptions> extends true
            ? PredicatePresence<TOptions> extends false
              ? AllEligibleColumns<TTerms> extends true
                ? true
                : boolean
              : boolean
            : boolean

/** Portable index metadata retained by a table and its aliases. */
export interface TableIndex<
  TTerms extends readonly IndexTerm[] = any,
  TOptions extends IndexOptions<any> = any,
> extends SchemaObjectIdentity {
  readonly kind: "index"
  readonly terms: TTerms
  readonly unique: UniqueOption<TOptions>
  readonly predicate: PredicateOption<TOptions>
  readonly includedColumns?: TOptions extends {
    readonly include: infer TIncluded
  }
    ? TIncluded
    : undefined
  readonly dialect?: DialectOption<TOptions>
  readonly method?: "method" extends keyof TOptions ? TOptions["method"] : undefined
  readonly backingConstraint?: "backingConstraint" extends keyof TOptions
    ? TOptions["backingConstraint"]
    : undefined
  readonly termOptions?: "termOptions" extends keyof TOptions ? TOptions["termOptions"] : undefined
  readonly candidateKey: IsCandidateKey<TTerms, TOptions>
}

/** The widened index shape accepted by source metadata records. */
export interface SourceIndex {
  readonly kind: "index"
  readonly terms: readonly IndexTerm[]
  readonly unique: boolean
  readonly predicate: AnyExpression | undefined
  readonly includedColumns?: readonly ColumnReference<string, any>[]
  readonly dialect?: IndexDialectExtension
  readonly method?: string
  readonly backingConstraint?: string
  readonly termOptions?: readonly (IndexTermOptions | undefined)[]
  readonly candidateKey: boolean
}

export type SourceIndexesRecord = Readonly<Record<string, SourceIndex>>

/**
 * Validate portable and dialect-owned index facts for one target adapter. Unsupported features are
 * reported as data so a serializer can aggregate diagnostics instead of failing during traversal
 * with an opaque exception.
 */
export function validateIndexDialect(
  indexMetadata: SourceIndex,
  dialect: string,
  path: readonly (string | number)[] = ["index"],
) {
  const diagnostics = [] as import("./metadata.ts").SchemaMetadataDiagnostic[]
  const extension = indexMetadata.dialect

  if (extension !== undefined) {
    const mismatch = dialectMismatchDiagnostic(extension, dialect, [...path, "dialect"])

    if (mismatch !== undefined) {
      diagnostics.push(mismatch)
    }
  }

  if (
    (dialect === "sqlite" || dialect === "mysql") &&
    indexMetadata.includedColumns !== undefined &&
    indexMetadata.includedColumns.length > 0
  ) {
    diagnostics.push({
      code: "unsupported-dialect-option",
      message: `${dialect} indexes do not support included columns`,
      path: [...path, "includedColumns"],
      dialect,
    })
  }

  const mysqlKeyBlockSize =
    extension?.dialect === "mysql" ? (extension as MysqlIndexExtension).keyBlockSize : undefined

  if (
    mysqlKeyBlockSize !== undefined &&
    (!Number.isInteger(mysqlKeyBlockSize) || mysqlKeyBlockSize <= 0)
  ) {
    diagnostics.push({
      code: "unsupported-dialect-option",
      message: "MySQL index keyBlockSize must be a positive integer",
      path: [...path, "dialect", "keyBlockSize"],
      dialect,
    })
  }

  return Object.freeze(diagnostics)
}

type ValidIndexExpression<T> = T extends AnyExpression
  ? HasAggregate<T> extends true
    ? never
    : HasWindow<T> extends true
      ? never
      : HasSubquery<T> extends true
        ? never
        : unknown
  : never

type InvalidIndexTerms<TTerms extends readonly IndexTerm[]> = {
  [K in keyof TTerms]: TTerms[K] extends OrderTerm<any>
    ? TTerms[K] extends { readonly nulls: "FIRST" | "LAST" }
      ? TTerms[K]
      : ValidIndexExpression<TTerms[K]["expression"]> extends never
        ? TTerms[K]
        : never
    : ValidIndexExpression<TTerms[K]> extends never
      ? TTerms[K]
      : never
}[number]

type IndexTermsValidation<TTerms extends readonly IndexTerm[]> = [
  InvalidIndexTerms<TTerms>,
] extends [never]
  ? unknown
  : never

/** Declare a portable column or expression index. */
export function index<
  const TTerms extends readonly [IndexTerm, ...IndexTerm[]],
  const TOptions extends IndexOptions<any> = {},
>(
  terms: TTerms & IndexTermsValidation<NoInfer<TTerms>>,
  options?: TOptions,
): TableIndex<TTerms, TOptions> {
  const resolvedOptions = options ?? ({} as TOptions)
  const candidateKey =
    resolvedOptions.unique === true &&
    resolvedOptions.where === undefined &&
    resolvedOptions.termOptions === undefined &&
    terms.every((term) => {
      const expression = "orderKind" in term ? term.expression : term

      return expression.expressionKind === "column"
    })

  return Object.freeze({
    kind: "index",
    terms: Object.freeze([...terms]),
    unique: resolvedOptions.unique === true,
    predicate: resolvedOptions.where,
    ...(resolvedOptions.include !== undefined
      ? {
          includedColumns: Object.freeze([...resolvedOptions.include]),
        }
      : {}),
    ...(resolvedOptions.physicalName !== undefined
      ? { physicalName: resolvedOptions.physicalName }
      : {}),
    ...(resolvedOptions.dialect !== undefined
      ? { dialect: freezeSchemaMetadata(resolvedOptions.dialect) }
      : {}),
    ...(resolvedOptions.method === undefined ? {} : { method: resolvedOptions.method }),
    ...(resolvedOptions.backingConstraint === undefined
      ? {}
      : { backingConstraint: resolvedOptions.backingConstraint }),
    ...(resolvedOptions.termOptions === undefined
      ? {}
      : {
          termOptions: Object.freeze(
            resolvedOptions.termOptions.map((term) =>
              term === undefined ? undefined : Object.freeze({ ...term }),
            ),
          ),
        }),
    candidateKey,
  }) as unknown as TableIndex<TTerms, TOptions>
}
