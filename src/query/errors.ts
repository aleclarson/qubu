/** Stable diagnostics shared by type-level and runtime query validation. */
export type QueryValidationErrorCode =
  | 'invalid-selection'
  | 'duplicate-clause'
  | 'invalid-mutation'
  | 'unsafe-mutation'
  | 'invalid-update'
  | 'invalid-insert'
  | 'invalid-comparison'
  | 'invalid-boolean-expression'
  | 'invalid-pagination'
  | 'invalid-row-lock'
  | 'invalid-json-path'
  | 'missing-source'
  | 'invalid-grouping'
  | 'incompatible-sql-domain'
  | 'incompatible-sql-equality'
  | 'incompatible-sql-order'
  | 'incompatible-set-domain'
  | 'invalid-subquery'
  | 'invalid-omission'
  | 'missing-dialect-capability'

export interface QueryValidationIssue {
  readonly code: QueryValidationErrorCode
  readonly context: string
  readonly path: readonly (string | number)[]
  readonly message: string
  readonly hint: string
}

/**
 * A type-level query failure that names the failing rule and the repair path.
 * The legacy detail field is optional so each validator can retain the useful
 * source or clause type in the compiler diagnostic.
 */
export type QueryTypeValidation<
  TCode extends QueryValidationErrorCode,
  TContext extends string,
  THint extends string,
  TDetail = never,
> = {
  readonly __qubu_error_code__: TCode
  readonly __qubu_error_context__: TContext
  readonly __qubu_error_hint__: THint
} & ([TDetail] extends [never]
  ? unknown
  : { readonly __qubu_error_detail__: TDetail })

/** Raised when a query cannot satisfy Qubu's runtime authoring rules. */
export class QueryValidationError extends TypeError {
  readonly name = 'QueryValidationError'
  readonly code: QueryValidationErrorCode
  readonly context: string
  readonly path: readonly (string | number)[]
  readonly hint: string
  readonly issue: QueryValidationIssue

  constructor(issue: QueryValidationIssue) {
    super(issue.message)
    this.code = issue.code
    this.context = issue.context
    this.path = Object.freeze([...issue.path])
    this.hint = issue.hint
    this.issue = Object.freeze({
      ...issue,
      path: this.path,
    })
  }
}

export function queryValidationError(
  issue: QueryValidationIssue
): QueryValidationError {
  return new QueryValidationError(issue)
}
