import { expect, test } from 'vitest'
import { render } from '../src/index.ts'
import { parenthesize, sequence, syntax } from '../src/core/index.ts'
import { users } from './fragment-metadata-fixtures.ts'

test('renders metadata-preserving composition without changing SQL output', () => {
  const reusable = parenthesize(
    sequence([users.name, syntax('COLLATE "C"')], ' ')
  )

  expect(render(reusable).text).toBe('("users"."name" COLLATE "C")')
})
