import { expectTypeOf } from "vitest"

import {
  asc,
  check,
  column,
  count,
  numeric,
  eq,
  foreignKey,
  from,
  index,
  integer,
  lower,
  over,
  primaryKey,
  references,
  scalar,
  select,
  table,
  text,
  unique,
  value,
} from "../src/index.ts"
import type { AnySqlType } from "../src/index.ts"

const accounts = table(
  "metadata_accounts",
  {
    tenantId: integer(),
    id: integer(),
    email: text(),
    active: column<boolean>(),
    nullableCode: text({ nullable: true }),
  },
  (accounts) => ({
    constraints: {
      accountsPrimary: primaryKey(accounts.tenantId, accounts.id),
      accountsEmailUnique: unique(accounts.email),
      accountsEmailCheck: check(eq(accounts.email, value("root@example.com"))),
    },
    indexes: {
      accountsIdentity: index([accounts.tenantId, asc(accounts.id)], {
        unique: true,
      }),
      accountsEmailLower: index([lower(accounts.email)]),
      activeAccounts: index([accounts.email], {
        where: eq(accounts.email, value("active@example.com")),
      }),
      nullableUnique: index([accounts.nullableCode], { unique: true }),
    },
  }),
)

const handles = table("metadata_handles", { slug: text() }, (handles) => ({
  constraints: {},
  indexes: { handlesSlug: index([handles.slug], { unique: true }) },
}))

const widenedIndexes = table(
  "metadata_widened_indexes",
  {
    id: integer(),
    runtimeId: integer(),
    active: text(),
  },
  (indexed) => {
    const predicate = eq(indexed.active, value("yes"))
    const present: {
      readonly unique: true
      readonly where?: typeof predicate
    } = {
      unique: true,
      where: predicate,
    }
    const absent: {
      readonly unique: true
      readonly where?: typeof predicate
    } = { unique: true }
    const requiredUnion: {
      readonly unique: true
      readonly where: typeof predicate | undefined
    } = {
      unique: true,
      where: undefined,
    }
    const optionalUnique: { readonly unique?: true } = { unique: true }
    const presentIndex = index([indexed.id], present)
    const absentIndex = index([indexed.runtimeId], absent)
    const requiredUnionIndex = index([indexed.id], requiredUnion)

    expectTypeOf(presentIndex.predicate).toEqualTypeOf<typeof predicate | undefined>()
    expectTypeOf(absentIndex.predicate).toEqualTypeOf<typeof predicate | undefined>()
    expectTypeOf(requiredUnionIndex.predicate).toEqualTypeOf<typeof predicate | undefined>()
    return {
      constraints: {},
      indexes: {
        present: presentIndex,
        absent: absentIndex,
        requiredUnion: requiredUnionIndex,
        optionalUnique: index([indexed.id], optionalUnique),
        exact: index([indexed.id], { unique: true }),
        exactPartial: index([indexed.id], {
          unique: true,
          where: predicate,
        }),
      },
    }
  },
)

expectTypeOf(widenedIndexes.indexes.present.unique).toEqualTypeOf<true>()
expectTypeOf(widenedIndexes.indexes.present.candidateKey).toEqualTypeOf<boolean>()
expectTypeOf(widenedIndexes.indexes.absent.candidateKey).toEqualTypeOf<boolean>()
expectTypeOf(widenedIndexes.indexes.requiredUnion.candidateKey).toEqualTypeOf<boolean>()
expectTypeOf(widenedIndexes.indexes.optionalUnique.unique).toEqualTypeOf<boolean>()
expectTypeOf(widenedIndexes.indexes.optionalUnique.candidateKey).toEqualTypeOf<boolean>()
expectTypeOf(widenedIndexes.indexes.exact.candidateKey).toEqualTypeOf<true>()
expectTypeOf(widenedIndexes.indexes.exactPartial.candidateKey).toEqualTypeOf<false>()

table(
  "metadata_memberships",
  {
    tenantId: integer(),
    accountId: integer({ nullable: true }),
    ownerEmail: text(),
    handle: text(),
  },
  (memberships) => ({
    constraints: {
      accountForeign: foreignKey(
        [memberships.tenantId, memberships.accountId],
        references(accounts, accounts.tenantId, accounts.id),
      ),
      emailForeign: foreignKey([memberships.ownerEmail], () =>
        references(accounts, accounts.email),
      ),
      indexForeign: foreignKey([memberships.handle], references(handles, handles.slug)),
    },
    indexes: {},
  }),
)

table(
  "metadata_employees",
  {
    id: integer(),
    managerId: integer({ nullable: true }),
  },
  (employees) => ({
    constraints: {
      employeesPrimary: primaryKey(employees.id),
      managerForeign: foreignKey([employees.managerId], references(employees, employees.id)),
    },
    indexes: {},
  }),
)

const unrelated = table("metadata_unrelated", {
  id: integer(),
  amount: numeric(),
  name: text(),
})

// @ts-expect-error Checks require the boolean SQL domain.
check(unrelated.id)

table(
  "metadata_invalid_external_check",
  { id: integer() },
  // @ts-expect-error Checks cannot read another source.
  (local) => ({
    constraints: {
      externalCheck: check(eq(local.id, unrelated.id)),
    },
    indexes: {},
  }),
)

table(
  "metadata_invalid_target_ownership",
  { id: integer() },
  // @ts-expect-error Referenced columns must belong to the referenced table.
  (local) => ({
    constraints: {
      invalidForeign: foreignKey([local.id], references(accounts, unrelated.id)),
    },
    indexes: {},
  }),
)

table(
  "metadata_invalid_aggregate_check",
  { id: integer() },
  // @ts-expect-error Checks cannot contain aggregates.
  (local) => ({
    constraints: {
      aggregateCheck: check(eq(count(local.id), value(1))),
    },
    indexes: {},
  }),
)

table(
  "metadata_invalid_window_check",
  { id: integer() },
  // @ts-expect-error Checks cannot contain windows.
  (local) => ({
    constraints: {
      windowCheck: check(eq(over(count(local.id)), value(1))),
    },
    indexes: {},
  }),
)

table(
  "metadata_invalid_subquery_check",
  { id: integer() },
  // @ts-expect-error Checks cannot contain subqueries.
  (local) => ({
    constraints: {
      subqueryCheck: check(eq(local.id, scalar(select({ id: unrelated.id }, from(unrelated))))),
    },
    indexes: {},
  }),
)

table(
  "metadata_invalid_index",
  { id: integer() },
  // @ts-expect-error Index terms and predicates must be local scalar expressions.
  (local) => ({
    constraints: {},
    indexes: {
      externalIndex: index([unrelated.id]),
      // @ts-expect-error Indexes cannot contain aggregates.
      aggregateIndex: index([count(local.id)]),
      windowPredicate: index([local.id], {
        where: eq(over(count(local.id)), value(1)),
      }),
      nonBooleanPredicate: index([local.id], { where: local.id }),
    },
  }),
)

const legacyTargets = table("metadata_legacy_targets", { id: column<number>() }, (legacy) => ({
  constraints: { legacyPrimary: primaryKey(legacy.id) },
  indexes: {},
}))

const broadDomainTargets = table(
  "metadata_broad_domain_targets",
  { id: column<number, number, number, {}, AnySqlType>() },
  (target) => ({
    constraints: { targetPrimary: primaryKey(target.id) },
    indexes: {},
  }),
)

table(
  "metadata_invalid_broad_domain_foreign_key",
  { targetId: column<number, number, number, {}, AnySqlType>() },
  (local) => ({
    constraints: {
      broadForeign: foreignKey(
        [local.targetId],
        // @ts-expect-error Broad SQL domains cannot prove foreign-key compatibility.
        references(broadDomainTargets, broadDomainTargets.id),
      ),
    },
    indexes: {},
  }),
)

table(
  "metadata_invalid_runtime_candidate_foreign_key",
  { targetId: integer() },
  // @ts-expect-error Runtime-dependent unique indexes are not candidate-key proofs.
  (local) => ({
    constraints: {
      runtimeCandidateForeign: foreignKey(
        [local.targetId],
        references(widenedIndexes, widenedIndexes.runtimeId),
      ),
    },
    indexes: {},
  }),
)

table(
  "metadata_invalid_foreign_keys",
  {
    id: integer(),
    name: text(),
  },
  // @ts-expect-error Foreign-key local columns must belong to this table.
  (local) => ({
    constraints: {
      externalLocal: foreignKey([unrelated.id], references(accounts, accounts.id)),
      wrongArity: foreignKey(
        [local.id],
        // @ts-expect-error Foreign-key arity must match.
        references(accounts, accounts.tenantId, accounts.id),
      ),
      // @ts-expect-error Foreign-key SQL domains must match exactly.
      wrongDomain: foreignKey([local.name], references(accounts, accounts.id)),
      unknownDomain: foreignKey(
        [local.id],
        // @ts-expect-error SqlUnknown cannot prove foreign-key compatibility.
        references(legacyTargets, legacyTargets.id),
      ),
    },
    indexes: {},
  }),
)

table(
  "metadata_invalid_non_candidate",
  { tenantId: integer() },
  // @ts-expect-error Target columns must match a candidate key.
  (local) => ({
    constraints: {
      invalidForeign: foreignKey([local.tenantId], references(accounts, accounts.tenantId)),
    },
    indexes: {},
  }),
)

table(
  "metadata_invalid_nullable_index_target",
  { code: text() },
  // @ts-expect-error Nullable unique indexes are not candidate keys.
  (local) => ({
    constraints: {
      invalidForeign: foreignKey([local.code], references(accounts, accounts.nullableCode)),
    },
    indexes: {},
  }),
)
