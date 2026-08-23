import { expectTypeOf } from 'vitest'
import { generatedColumn, identityColumn, integer, text } from '../src/index.ts'
import { defineSchemaExpression } from '../src/schema/index.ts'
import type {
  ColumnDefaultOf,
  ColumnGeneratedOf,
  ColumnHasDefault,
  ColumnIdentityOf,
  ColumnIsGenerated,
  ExternalDefaultDescriptor,
  ExternalGeneratedColumnDescriptor,
  ExpressionGeneratedColumnDescriptor,
  IdentityDescriptor,
  LiteralDefaultDescriptor,
} from '../src/index.ts'

const expression = defineSchemaExpression('function', context => {
  context.append('CURRENT_TIMESTAMP')
})
const literalDefault = text({ default: 'pending' })
const expressionDefault = text({ default: expression })
const generated = integer({
  generatedColumn: generatedColumn(expression, 'stored'),
})
const identity = integer({ identity: identityColumn('by-default') })
const legacyDefault = text({ hasDefault: true })
const legacyGenerated = integer({ generated: true })

expectTypeOf<ColumnHasDefault<typeof literalDefault>>().toEqualTypeOf<true>()
expectTypeOf<
  ColumnDefaultOf<typeof literalDefault>
>().toMatchTypeOf<LiteralDefaultDescriptor>()
expectTypeOf<ColumnDefaultOf<typeof expressionDefault>>().toMatchTypeOf<{
  readonly kind: 'expression'
}>()
expectTypeOf<ColumnIsGenerated<typeof generated>>().toEqualTypeOf<true>()
expectTypeOf<
  ColumnGeneratedOf<typeof generated>
>().toMatchTypeOf<ExpressionGeneratedColumnDescriptor>()
expectTypeOf<ColumnIsGenerated<typeof identity>>().toEqualTypeOf<true>()
expectTypeOf<
  ColumnIdentityOf<typeof identity>
>().toEqualTypeOf<IdentityDescriptor>()
expectTypeOf<
  ColumnDefaultOf<typeof legacyDefault>
>().toEqualTypeOf<ExternalDefaultDescriptor>()
expectTypeOf<
  ColumnGeneratedOf<typeof legacyGenerated>
>().toEqualTypeOf<ExternalGeneratedColumnDescriptor>()

// Complete descriptors retain the existing mutation derivation: defaulted
// columns are optional and generated/identity columns are omitted.
const insert = { status: 'pending' } satisfies {
  status?: string
}
void insert
