import { diffSnapshots } from "../src/diff/index.ts"
import type {
  MigrationDecision,
  MigrationPlan,
  MigrationPlanOptions,
  MigrationPlanResult,
} from "../src/migration/index.ts"
import { createMigrationPlan } from "../src/migration/index.ts"
import type { SchemaSnapshot } from "../src/snapshot/types.ts"

declare const diff: Parameters<typeof createMigrationPlan>[0]
declare const plan: MigrationPlan
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
