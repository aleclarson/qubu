import { expectTypeOf } from "vitest"

import {
  catalogCheck,
  catalogForeignKey,
  check,
  column,
  foreignKey,
  integer,
  primaryKey,
  references,
  table,
  text,
  unsafeSchemaSql,
} from "../src/index.ts"
import type { ExpressionOutput, ExpressionSqlType, SqlBoolean } from "../src/index.ts"

const unknownTargets = table(
  "reconstruction_unknown_targets",
  {
    id: column<number>(),
    otherId: column<number>(),
  },
  (target) => ({
    constraints: { targetPrimary: primaryKey(target.id) },
    indexes: {},
  }),
)

table("reconstruction_unknown_references", { targetId: column<number>() }, (local) => ({
  constraints: {
    targetForeign: catalogForeignKey([local.targetId], () =>
      references(unknownTargets, unknownTargets.id),
    ),
  },
  indexes: {},
}))

table(
  "reconstruction_non_candidate_reference",
  { targetId: column<number>() },
  // @ts-expect-error Catalog foreign keys still require target candidate-key metadata.
  (local) => ({
    constraints: {
      targetForeign: catalogForeignKey(
        [local.targetId],
        references(unknownTargets, unknownTargets.otherId),
      ),
    },
    indexes: {},
  }),
)

const knownTargets = table("reconstruction_known_targets", { id: integer() }, (target) => ({
  constraints: { targetPrimary: primaryKey(target.id) },
  indexes: {},
}))
const knownLocal = table("reconstruction_known_local", {
  integerId: integer(),
  textId: text(),
})

catalogForeignKey([knownLocal.integerId], references(knownTargets, knownTargets.id))

catalogForeignKey(
  [knownLocal.textId],
  // @ts-expect-error Catalog reconstruction still rejects known SQL-domain mismatches.
  references(knownTargets, knownTargets.id),
)

catalogForeignKey(
  [knownLocal.integerId],
  // @ts-expect-error Catalog reconstruction still requires equal column arity.
  references(unknownTargets, unknownTargets.id, unknownTargets.otherId),
)

foreignKey(
  [knownLocal.integerId],
  // @ts-expect-error Ordinary foreign keys still require concrete SQL-domain proof.
  references(unknownTargets, unknownTargets.id),
)

const opaqueCheck = catalogCheck({
  dialect: "postgresql",
  sql: "integer_id > 0",
})

expectTypeOf<ExpressionSqlType<typeof opaqueCheck.expression>>().toEqualTypeOf<SqlBoolean>()
expectTypeOf<ExpressionOutput<typeof opaqueCheck.expression>>().toEqualTypeOf<boolean>()

// @ts-expect-error Ordinary checks do not infer a boolean domain from opaque SQL.
check(unsafeSchemaSql("postgresql", "integer_id > 0"))

catalogCheck({
  // @ts-expect-error Catalog checks require a supported introspection dialect.
  dialect: "oracle",
  sql: "integer_id > 0",
})
