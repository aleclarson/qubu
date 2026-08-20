import { expect, test } from 'vitest'
import {
  ColumnBehaviorError,
  column,
  defineSchemaExpression,
  externalDefault,
  externalGeneratedColumn,
  generatedColumn,
  identityColumn,
  integer,
  text,
  value,
} from '../src/index.ts'

test('normalizes complete defaults and generated behavior without rendering SQL', () => {
  const expression = defineSchemaExpression('function', context => {
    context.append('CURRENT_TIMESTAMP')
  })
  const createdAt = text({ default: expression })
  const computed = integer({
    generatedColumn: generatedColumn(expression, 'virtual'),
  })
  const identity = integer({ identity: identityColumn('always') })
  const legacyIdentity = integer({
    generated: true,
    identity: identityColumn('by-default'),
  })

  expect(createdAt.hasDefault).toBe(true)
  expect(createdAt.default).toEqual({
    kind: 'expression',
    expression,
  })
  expect(computed.generated).toBe(true)
  expect(computed.generatedColumn).toEqual({
    kind: 'expression',
    expression,
    mode: 'virtual',
  })
  expect(identity.generated).toBe(true)
  expect(identity.identity).toEqual({ kind: 'identity', generation: 'always' })
  expect(identity.generatedColumn).toBeUndefined()
  expect(legacyIdentity.generatedColumn).toBeUndefined()
  expect(Object.isFrozen(createdAt)).toBe(true)
  expect(Object.isFrozen(createdAt.default)).toBe(true)
  expect(Object.isFrozen(computed.generatedColumn)).toBe(true)
})

test('represents legacy write flags as explicit external behavior', () => {
  const legacyDefault = text({ hasDefault: true })
  const legacyGenerated = integer({ generated: true })
  const explicitExternal = text({ default: externalDefault() })
  const explicitGenerated = integer({
    generatedColumn: externalGeneratedColumn(),
  })

  expect(legacyDefault.default).toEqual({ kind: 'external' })
  expect(legacyGenerated.generatedColumn).toEqual({ kind: 'external' })
  expect(explicitExternal.hasDefault).toBe(true)
  expect(explicitGenerated.generated).toBe(true)
})

test('canonicalizes supported literal values', () => {
  expect(column({ default: null }).default).toEqual({
    kind: 'literal',
    value: { kind: 'null' },
  })
  expect(column({ default: -0 }).default).toEqual({
    kind: 'literal',
    value: { kind: 'number', value: '0' },
  })
  expect(column({ default: 42n }).default).toEqual({
    kind: 'literal',
    value: { kind: 'bigint', value: '42' },
  })
  expect(column({ default: "O'Reilly" }).default).toEqual({
    kind: 'literal',
    value: { kind: 'string', value: "O'Reilly" },
  })
})

test('treats strings as literals and branded values as expressions', () => {
  const stringDefault = text({ default: 'CURRENT_TIMESTAMP' })
  const expression = defineSchemaExpression('function', context => {
    context.append('CURRENT_TIMESTAMP')
  })
  const expressionDefault = text({ default: expression })

  expect(stringDefault.default).toEqual({
    kind: 'literal',
    value: { kind: 'string', value: 'CURRENT_TIMESTAMP' },
  })
  expect(expressionDefault.default).toEqual({
    kind: 'expression',
    expression,
  })
})

test('rejects incompatible complete behavior early', () => {
  expect(() => column({ default: 1, hasDefault: false })).toThrowError(
    ColumnBehaviorError
  )
  expect(() =>
    column({
      generatedColumn: generatedColumn(value(1)),
      identity: identityColumn(),
    })
  ).toThrowError(ColumnBehaviorError)
  expect(() =>
    column({
      default: 1,
      generatedColumn: generatedColumn(value(1)),
    })
  ).toThrowError(ColumnBehaviorError)

  try {
    column({ default: 1, hasDefault: false })
  } catch (error) {
    expect(error).toMatchObject({
      name: 'ColumnBehaviorError',
      code: 'default-flag-conflict',
      path: 'hasDefault',
    })
  }
})
