import { expectTypeOf, test } from 'vitest'
import {
  customClause,
  eq,
  from,
  integer,
  select,
  table,
  text,
  where,
} from '../src/index.ts'
import type { ParametersOf } from '../src/index.ts'

const users = table('users', {
  id: integer(),
  name: text(),
})

test('exposes value-type parameter metadata through composed fragments', () => {
  const query = select(
    { id: users.id },
    from(users),
    where(eq(users.id, 42)),
    customClause<never, Date>({
      name: 'as-of',
      order: 80,
      render(context) {
        context.append('AS OF ')
        context.parameter(new Date('2026-01-01T00:00:00.000Z'))
      },
    })
  )

  const numberParameter: ParametersOf<typeof query> = 42
  const dateParameter: ParametersOf<typeof query> = new Date()

  expectTypeOf(numberParameter).toMatchTypeOf<number>()
  expectTypeOf(dateParameter).toMatchTypeOf<Date>()
})
