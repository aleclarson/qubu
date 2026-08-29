import type { SchemaSnapshot } from "qubu/snapshot"

import type {
  ExecutableMigrationArtifact,
  MigrationProgram,
  TaggedParameterValue,
  VerifiedBaselineArtifact,
} from "../src/artifact/index.ts"

declare const executable: ExecutableMigrationArtifact
declare const baseline: VerifiedBaselineArtifact
declare const snapshot: SchemaSnapshot

const program: MigrationProgram = executable.program
const parameter: TaggedParameterValue = {
  type: "bigint",
  value: "42",
}
const baselineSnapshot = baseline.snapshot

void [program, parameter, baselineSnapshot, snapshot]

// @ts-expect-error Baselines are deliberately non-executable.
void baseline.program
const invalidParameter: TaggedParameterValue = {
  // @ts-expect-error Parameters must carry a supported tag.
  type: "date",
  value: "today",
}

void invalidParameter
