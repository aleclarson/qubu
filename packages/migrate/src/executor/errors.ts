export type MigrationErrorCode =
  | "validation"
  | "policy"
  | "drift"
  | "concurrency"
  | "capability"
  | "definite-rollback"
  | "uncertain-outcome"
  | "recovery-required"
  | "aborted"
  | "adapter"

export interface MigrationErrorContext {
  readonly artifactId?: string
  readonly artifactDigest?: string
  readonly attemptId?: string
  readonly phaseId?: string
  readonly statementId?: string
}

export class MigrationExecutionError extends Error {
  readonly name = "MigrationExecutionError"
  readonly retry: "safe" | "never"

  constructor(
    readonly code: MigrationErrorCode,
    message: string,
    readonly context: MigrationErrorContext = {},
    options: { readonly cause?: unknown; readonly retry?: "safe" | "never" } = {},
  ) {
    super(message, { cause: redactCause(options.cause) })
    this.retry = options.retry ?? "never"
  }
}

function redactCause(cause: unknown): unknown {
  if (cause === undefined) return undefined
  if (cause instanceof Error) return Object.freeze({ name: cause.name })
  if (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    typeof cause.code === "string"
  ) {
    return Object.freeze({ code: cause.code })
  }
  return Object.freeze({ name: "UnknownError" })
}

export function safeFailure(
  error: unknown,
  context: MigrationErrorContext = {},
): {
  readonly code: string
  readonly message: string
  readonly phaseId?: string
  readonly statementId?: string
} {
  const value = error instanceof MigrationExecutionError ? error : undefined
  return {
    code: value?.code ?? "adapter",
    message: value?.message ?? "Migration adapter operation failed",
    ...(context.phaseId ? { phaseId: context.phaseId } : {}),
    ...(context.statementId ? { statementId: context.statementId } : {}),
  }
}

export function isRetrySafe(error: unknown): boolean {
  return error instanceof MigrationExecutionError && error.retry === "safe"
}
