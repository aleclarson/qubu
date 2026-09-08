import type { SchemaSnapshot } from "qubu/snapshot"

import {
  captureBaseline,
  createBaseline,
  preflightBaseline,
  type BaselineConfirmation,
  type BaselineAdapter,
} from "../src/baseline/index.ts"

declare const adapter: BaselineAdapter
declare const scope: SchemaSnapshot
declare const candidate: SchemaSnapshot
declare const confirmation: BaselineConfirmation

captureBaseline({
  adapter,
  scope,
})
preflightBaseline({
  adapter,
  scope,
  candidate,
  repository: [],
})
createBaseline({
  adapter,
  scope,
  candidate,
  repository: [],
  confirmation,
  id: "initial",
  provenance: { source: "reviewed" },
})

// @ts-expect-error Acceptance requires an explicitly selected candidate.
createBaseline({
  adapter,
  scope,
  repository: [],
  confirmation,
  id: "initial",
  provenance: { source: "reviewed" },
})
// @ts-expect-error Verification requires the original managed scope, not only present candidate tables.
preflightBaseline({
  adapter,
  candidate,
  repository: [],
})
// @ts-expect-error History must be checked for API callers too.
preflightBaseline({
  adapter,
  scope,
  candidate,
})
// @ts-expect-error Compatibility is an operator responsibility, not a claim that desired code can already run.
const legacyFact: keyof BaselineConfirmation = "applicationCompatible"

void legacyFact
