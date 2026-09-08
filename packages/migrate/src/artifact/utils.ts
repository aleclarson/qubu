import type { MigrationProgramCompilationResult, ProgramCompilationDiagnostic } from "./types.ts"

export function compilationFailure(
  code: ProgramCompilationDiagnostic["code"],
  message: string,
  path: readonly (string | number)[],
): Extract<MigrationProgramCompilationResult, { readonly ok: false }> {
  return {
    ok: false,
    diagnostics: Object.freeze([{ code, message, path }]),
  }
}

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}
