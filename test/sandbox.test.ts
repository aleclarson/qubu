import * as pgtmp from '@pg-nano/pg-tmp'
import { postgres } from 'pg-socket'
import { test } from 'vitest'
import {
  and,
  distinctOn,
  from,
  isEqual,
  isNotNull,
  orderBy,
  pgTable,
  select,
  sql,
  text,
  uuid,
  where,
} from 'yiss'

const db = await postgres(await pgtmp.start())

const User = pgTable('user', {
  id: uuid().primaryKey(),
  name: text(),
})

const user1 = sql(select(User.name), from(User), where(User.id.is('=', 1)))

const dumbUser = User.as('dumb_user')

sql(
  select({
    id: dumbUser.id,
    name: dumbUser.name,
  }),
  from(dumbUser),
  where(
    isEqual(dumbUser.id, 1),
    and(dumbUser.name, isNotNull()),
    and(dumbUser.name, isNotNull())
  ),
  orderBy(dumbUser.id.asc())
)

test('select distinct on', () => {
  const query = select(
    distinctOn(dumbUser.id, dumbUser.name),
    {
      id: dumbUser.id,
      name: dumbUser.name,
    },
    from(dumbUser),
    where(
      isEqual(dumbUser.id, 1),
      and(dumbUser.name, isNotNull()),
      and(dumbUser.name, isNotNull())
    )
  )
})
