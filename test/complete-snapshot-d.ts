import {
  assertCompleteSchemaSnapshot,
  completeSchemaSnapshotFingerprint,
  decodeSchemaSnapshotV1,
  encodeSchemaSnapshotV1,
  type SchemaSnapshotV1,
} from "../src/snapshot/index.ts"

declare const snapshot: SchemaSnapshotV1
const decoded = decodeSchemaSnapshotV1(encodeSchemaSnapshotV1(snapshot))

if (decoded.ok) {
  const value: SchemaSnapshotV1 = assertCompleteSchemaSnapshot(decoded.value)
  const fingerprint: string = completeSchemaSnapshotFingerprint(value)

  void fingerprint
}
