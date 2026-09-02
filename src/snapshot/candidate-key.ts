import type { CompleteSnapshotColumn, CompleteSnapshotIndex } from "./complete-types.ts"

/** Return the column IDs for an index whose shape can prove a candidate key. */
export function candidateKeyIndexColumns(
  index: CompleteSnapshotIndex,
): readonly string[] | undefined {
  if (!index.unique || index.predicate !== undefined || index.terms.length === 0) {
    return undefined
  }

  // Keep the proof conservative: predicates, expressions, prefixes, and operator classes carry
  // index semantics that the portable candidate-key type cannot represent.
  const columns: string[] = []

  for (const term of index.terms) {
    if (
      term.kind !== "column" ||
      term.prefixLength !== undefined ||
      term.operatorClass !== undefined
    ) {
      return undefined
    }

    columns.push(term.column)
  }

  return columns
}

/** Return whether an index's facts prove a non-null, non-lossy candidate key. */
export function hasCandidateKeyShape(
  index: CompleteSnapshotIndex,
  columns: ReadonlyMap<string, Pick<CompleteSnapshotColumn, "nullable"> | boolean>,
): boolean {
  const indexColumns = candidateKeyIndexColumns(index)

  return (
    indexColumns !== undefined &&
    indexColumns.every((column) => {
      const nullable = columns.get(column)
      return (typeof nullable === "boolean" ? nullable : nullable?.nullable) === false
    })
  )
}

/** Return whether the snapshot explicitly marks a shape-proven index as a candidate key. */
export function isCandidateKeyIndex(
  index: CompleteSnapshotIndex,
  columns: ReadonlyMap<string, Pick<CompleteSnapshotColumn, "nullable"> | boolean>,
): boolean {
  return index.candidateKey && hasCandidateKeyShape(index, columns)
}
