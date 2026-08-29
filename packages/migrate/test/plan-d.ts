import { diffSnapshots } from "qubu/diff"
import type { SchemaSnapshot } from "qubu/snapshot"

import type {
  MigrationDecision,
  MigrationPlan,
  MigrationPlanOptions,
  MigrationPlanResult,
} from "../src/plan/index.ts"
import { createMigrationPlan } from "../src/plan/index.ts"

declare const diff: Parameters<typeof createMigrationPlan>[0]
declare const options: MigrationPlanOptions

const result: MigrationPlanResult = createMigrationPlan(diff, options)
const readonlyOperations: readonly MigrationPlan["operations"][number][] = result.plan.operations
const decision: MigrationDecision = {
  action: "allow",
  reason: "reviewed",
}

void readonlyOperations
void decision

const snapshot: SchemaSnapshot = {
  format: "qubu-schema",
  version: 1,
  dialect: {
    name: "neutral",
    version: 1,
  },
  namingPolicy: {
    name: "test",
    version: 1,
  },
  namespace: "public",
  tables: [],
}

const diffFromPublicEntry = diffSnapshots(snapshot, snapshot)

void diffFromPublicEntry
