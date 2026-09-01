import {
  assertCompleteSchemaSnapshot,
  canonicalizeCompleteSchemaSnapshot,
  CompleteSnapshotValidationError,
  decodeCompleteSchemaSnapshot,
} from "./complete.ts"
import type { SchemaSnapshot, SchemaSnapshotInput, SnapshotDecodeResult } from "./types.ts"

/** Error raised by throwing snapshot APIs after collecting diagnostics. */
export class SnapshotValidationError extends CompleteSnapshotValidationError {
  readonly name: string = "SnapshotValidationError"
}

/** Decode and strictly validate the canonical Snapshot v1 JSON value. */
export function decodeSchemaSnapshot(input: string | unknown): SnapshotDecodeResult {
  return decodeCompleteSchemaSnapshot(input)
}

/** Validate a Snapshot v1 value and throw one structured error if it is malformed. */
export function assertSchemaSnapshot(input: SchemaSnapshotInput | string): SchemaSnapshot {
  const result = decodeSchemaSnapshot(input)

  if (!result.ok) {
    throw new SnapshotValidationError(result.diagnostics)
  }

  return result.value
}

/** Return a fixed-order, deeply immutable copy of a valid Snapshot v1 value. */
export function canonicalizeSchemaSnapshot(input: SchemaSnapshotInput): SchemaSnapshot {
  return canonicalizeCompleteSchemaSnapshot(input)
}

/** Keep the complete decoder available under its explicit complete names. */
export { assertCompleteSchemaSnapshot, decodeCompleteSchemaSnapshot }
