import {
  assertCompleteSchemaSnapshot,
  completeSchemaSnapshotDigest,
  decodeSchemaSnapshotV2,
  encodeSchemaSnapshotV2,
  type SchemaSnapshotV2,
} from "../src/snapshot/index.ts"

declare const snapshot: SchemaSnapshotV2
const decoded = decodeSchemaSnapshotV2(encodeSchemaSnapshotV2(snapshot))

if (decoded.ok) {
  const value: SchemaSnapshotV2 = assertCompleteSchemaSnapshot(decoded.value)
  const digest: string = completeSchemaSnapshotDigest(value)

  void digest
}
