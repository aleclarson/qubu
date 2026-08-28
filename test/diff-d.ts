import {
  compareSnapshots,
  diffSnapshots,
  encodeRenameHints,
  type SnapshotDiff,
  type SnapshotRenameHint,
} from "../src/diff/index.ts"

declare const before: Parameters<typeof diffSnapshots>[0]
declare const after: Parameters<typeof diffSnapshots>[1]
declare const hint: SnapshotRenameHint

const result: SnapshotDiff = compareSnapshots(before, after, {
  renameHints: [hint],
})
const encoded: string = encodeRenameHints([hint])

void result
void encoded
