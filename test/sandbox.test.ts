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

const dumbUser = User.as('dumb_user')

User.id
dumbUser.id

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
).toQuery(db)

test('select distinct on', () => {
  const query = select(
    distinctOn(dumbUser.id, dumbUser.name),
    from(dumbUser),
    where(
      isEqual(dumbUser.id, 1),
      and(dumbUser.name, isNotNull()),
      and(dumbUser.name, isNotNull())
    )
  )
})
