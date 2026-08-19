import { expect, expectTypeOf, test } from 'vitest'
import {
  and,
  count,
  createDialect,
  defineSchemaExpression,
  gt,
  lower,
  postgresDialect,
  renderSchemaExpression,
  renderSchemaSql,
  schemaExpression,
  table,
  text,
  unsafeSchemaSql,
  value,
} from '../src/index.ts'
import type {
  AnySchemaExpression,
  SchemaExpression,
  SchemaExpressionMode,
} from '../src/index.ts'
import { integer } from '../src/index.ts'
import { makeExpression } from '../src/index.ts'
import type { ResultMeta } from '../src/index.ts'

const users = table('schema_expression_users', {
  age: integer(),
  name: text(),
})

test('renders deterministic scalar expressions with schema literals', () => {
  const expression = and(gt(users.age, 18), gt(lower(users.name), 'ada'))

  expect(renderSchemaExpression(expression, { mode: 'check' })).toEqual({
    text: `(("age" > 18) AND (LOWER("name") > 'ada'))`,
    parameters: [],
  })
  expect(renderSchemaSql(value("O'Reilly"), { mode: 'default' })).toBe(
    "'O''Reilly'"
  )
})

test('uses bare physical columns outside default expressions', () => {
  expect(renderSchemaExpression(gt(users.age, 18), 'generated').text).toBe(
    '("age" > 18)'
  )
  expect(() =>
    renderSchemaExpression(users.age, { mode: 'default' })
  ).toThrowError(/cannot reference table columns/)
})

test('rejects parameters, query-only expressions, and unbranded extensions', () => {
  const parameterized = makeExpression<ResultMeta<number>, 'function'>(
    'function',
    context => context.parameter(1)
  )

  expect(() =>
    renderSchemaExpression(parameterized as AnySchemaExpression, {
      mode: 'check',
    })
  ).toThrowError(/branded deterministic/)
  expect(() =>
    renderSchemaExpression(schemaExpression(parameterized), { mode: 'check' })
  ).toThrowError(/cannot render query parameters/)
  expect(() =>
    renderSchemaExpression(schemaExpression(count()), { mode: 'index' })
  ).toThrowError(/Aggregates, windows, and subqueries/)
})

test('supports explicit deterministic extensions and dialect literals', () => {
  const extension = defineSchemaExpression('function', context => {
    context.append('CURRENT_DATE')
  })
  const dialect = createDialect({
    name: 'literal-test',
    placeholder: position => `:p${position}`,
    renderSchemaLiteral(input) {
      return typeof input === 'number' ? `NUM(${input})` : String(input)
    },
  })

  expect(renderSchemaExpression(extension, { mode: 'default' }).text).toBe(
    'CURRENT_DATE'
  )
  expect(renderSchemaExpression(gt(users.age, 18), 'check', dialect).text).toBe(
    '("age" > NUM(18))'
  )
})

test('normalizes only raw schema SQL line endings and enforces dialect tags', () => {
  const raw = unsafeSchemaSql('postgresql', 'CURRENT\r\nDATE\rLOCALTIME')

  expect(
    renderSchemaExpression(raw, {
      mode: 'default',
      dialect: postgresDialect(),
    }).text
  ).toBe('CURRENT\nDATE\nLOCALTIME')
  expect(() =>
    renderSchemaExpression(raw, { mode: 'default', dialect: postgresDialect() })
  ).not.toThrow()
  expect(() =>
    renderSchemaExpression(unsafeSchemaSql('sqlite', 'CURRENT_DATE'), {
      mode: 'default',
      dialect: postgresDialect(),
    })
  ).toThrowError(/tagged for "sqlite"/)
})

test('exposes a nominal schema-expression type', () => {
  const expression = gt(users.age, 0)

  expectTypeOf(expression).toMatchTypeOf<SchemaExpression>()
  expectTypeOf(expression).toMatchTypeOf<AnySchemaExpression>()
  expectTypeOf<SchemaExpressionMode>().toEqualTypeOf<
    'default' | 'generated' | 'check' | 'index'
  >()
})
