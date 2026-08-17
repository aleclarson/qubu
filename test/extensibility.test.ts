import { expect, test } from 'vitest'
import {
  aliasExpression,
  createDialect,
  customClause,
  from,
  makeExpression,
  render,
  select,
  table,
  text,
  unsafeExpression,
} from '../src/index.ts'

const users = table('users', { name: text() })

test('accepts a dialect without changing query construction', () => {
  const dialect = createDialect({
    name: 'bracketed',
    quoteIdentifier: name => `[${name}]`,
    placeholder: position => `:p${position}`,
  })
  const query = select(
    {
      name: users.name,
      current: aliasExpression(unsafeExpression('CURRENT_DATE'), 'current'),
    },
    from(users)
  )

  expect(render(query, dialect)).toEqual({
    text: 'SELECT [users].[name] AS [name], CURRENT_DATE AS [current] FROM [users]',
    parameters: [],
  })
})

test('composes custom fragments and clauses', () => {
  const customExpression = makeExpression<number, never, never, 'function'>(
    'function',
    context => context.append('42')
  )
  const custom = customClause({
    name: 'sample',
    order: 90,
    render: context => context.append('FETCH FIRST 1 ROW ONLY'),
  })
  const query = select(
    { answer: aliasExpression(customExpression, 'answer') },
    from(users),
    custom
  )

  expect(render(query).text).toBe(
    'SELECT 42 AS "answer" FROM "users" FETCH FIRST 1 ROW ONLY'
  )
})
