import * as root from "qubu"
import { generateSchemaSource } from "qubu/codegen"
import type { CodegenColumnContext, CodegenNameContext, SchemaCodegenResult } from "qubu/codegen"
import type { IntrospectionResult } from "qubu/introspection"
import { expectTypeOf } from "vitest"

import { column, index, primaryKey, table, unique } from "../src/index.ts"
import type { ColumnInsertInput, ColumnOutput, ColumnUpdateInput } from "../src/index.ts"
import { accountEntries } from "./codegen-rich.generated.ts"

declare const introspection: IntrospectionResult
const generated: SchemaCodegenResult = generateSchemaSource(introspection, {
  naming(context: CodegenNameContext) {
    return context.suggestedName
  },
  mapColumn(context: CodegenColumnContext) {
    return context.nativeType === "text"
      ? {
          output: "string",
          sqlDomain: "text",
        }
      : undefined
  },
})

if (generated.ok) {
  expectTypeOf(generated.source).toEqualTypeOf<string>()
} else {
  expectTypeOf(generated.source).toEqualTypeOf<undefined>()
}

generateSchemaSource(introspection, {
  // @ts-expect-error Column mappings select from fixed source-safe tokens.
  mapColumn() {
    return {
      output: 'import("untrusted")',
    }
  },
})

// @ts-expect-error Code generation stays opt-in through qubu/codegen.
root.generateSchemaSource

expectTypeOf<ColumnOutput<typeof accountEntries.definitions.status>>().toEqualTypeOf<unknown>()
expectTypeOf<ColumnInsertInput<typeof accountEntries.definitions.status>>().toEqualTypeOf<unknown>()
expectTypeOf<ColumnUpdateInput<typeof accountEntries.definitions.status>>().toEqualTypeOf<unknown>()

const nonNullUnknown = table(
  "non_null_unknown",
  {
    id: column<unknown>({ nullable: false }),
    payload: column<unknown>({ nullable: true }),
  },
  (current) => ({
    constraints: {
      primary: primaryKey(current.id),
      unique: unique(current.id),
    },
    indexes: {
      candidate: index([current.id], {
        unique: true,
        include: [current.payload],
      }),
    },
  }),
)

expectTypeOf(nonNullUnknown.id).not.toBeNullable()
expectTypeOf(nonNullUnknown.indexes.candidate.candidateKey).toEqualTypeOf<true>()

table("nullable_unknown_primary", { id: column<unknown>({ nullable: true }) }, (current) => ({
  constraints: {
    // @ts-expect-error Declared-nullable unknown columns cannot form primary keys.
    primary: primaryKey(current.id),
  },
  indexes: {},
}))

table("nullable_unknown_unique", { id: column<unknown>({ nullable: true }) }, (current) => ({
  constraints: {
    // @ts-expect-error Declared-nullable unknown columns cannot form strict unique keys.
    unique: unique(current.id),
  },
  indexes: {},
}))

const nullableUnknownIndex = table(
  "nullable_unknown_index",
  { id: column<unknown>({ nullable: true }) },
  (current) => ({
    constraints: {},
    indexes: {
      uniqueIndex: index([current.id], { unique: true }),
    },
  }),
)

expectTypeOf(nullableUnknownIndex.indexes.uniqueIndex.candidateKey).toEqualTypeOf<false>()
