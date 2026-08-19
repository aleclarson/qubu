import { expect, test } from 'vitest'
import {
  ColumnBehaviorError,
  column,
  defaultExpression,
  defaultLiteral,
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
  const createdAt = text({ default: defaultExpression(expression) })
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
  expect(defaultLiteral(null)).toEqual({
    kind: 'literal',
    value: { kind: 'null' },
  })
  expect(defaultLiteral(-0)).toEqual({
    kind: 'literal',
    value: { kind: 'number', value: '0' },
  })
  expect(defaultLiteral(42n)).toEqual({
    kind: 'literal',
    value: { kind: 'bigint', value: '42' },
  })
  expect(defaultLiteral("O'Reilly")).toEqual({
    kind: 'literal',
    value: { kind: 'string', value: "O'Reilly" },
  })
})

test('rejects incompatible complete behavior early', () => {
  expect(() =>
    column({ default: defaultLiteral(1), hasDefault: false })
  ).toThrowError(ColumnBehaviorError)
  expect(() =>
    column({
      generatedColumn: generatedColumn(value(1)),
      identity: identityColumn(),
    })
  ).toThrowError(ColumnBehaviorError)
  expect(() =>
    column({
      default: defaultLiteral(1),
      generatedColumn: generatedColumn(value(1)),
    })
  ).toThrowError(ColumnBehaviorError)

  try {
    column({ default: defaultLiteral(1), hasDefault: false })
  } catch (error) {
    expect(error).toMatchObject({
      name: 'ColumnBehaviorError',
      code: 'default-flag-conflict',
      path: 'hasDefault',
    })
  }
})
