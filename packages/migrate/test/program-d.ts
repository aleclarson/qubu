import {
  type CustomProgramSubstitution,
  type MigrationProgram,
  type ProgramCondition,
} from "@qubu/migrate/artifact"
import { compileMigrationProgram } from "@qubu/migrate/artifact/sqlite"
import type { MigrationPlan } from "@qubu/migrate/plan"

declare const plan: MigrationPlan

const result = compileMigrationProgram(plan, {
  customPrograms: [
    {
      operationId: "op_1",
      source: "application",
      reason: "Custom operation",
      transaction: "optional",
      lock: "shared",
      statements: [{ sql: "SELECT ?", parameters: [{ type: "string", value: "bound" }] }],
    },
  ],
})

if (result.ok) {
  const program: MigrationProgram = result.program
  void program
}

const invalid: CustomProgramSubstitution = {
  operationId: "op_1",
  source: "application",
  reason: "Custom operation",
  // @ts-expect-error unresolved transaction requirements cannot enter a program
  transaction: "unknown",
  lock: "none",
  statements: [],
}
void invalid

const propertyCondition: ProgramCondition = {
  id: "column-nullable",
  type: "property-equals",
  value: {
    type: "property-equals",
    path: ["tables", 0, "columns", 0],
    kind: "column",
    namespace: "public",
    logicalId: "name",
    physicalName: "name",
    parent: { kind: "table", id: "accounts", namespace: "public" },
    property: ["nullable"],
    value: false,
  },
}
void propertyCondition
