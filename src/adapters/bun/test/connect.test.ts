import * as pgtmp from '@pg-nano/pg-tmp'
import { expect, test } from 'bun:test'
import { qubu, select } from 'qubu'
import { bunAdapter } from '../index.ts'

test('connect', async () => {
  const { dsn } = await pgtmp.start({ host: 'localhost' })
  const db = qubu(new Bun.SQL(dsn), bunAdapter)

  expect(await db.query(select({ one: 1 }))).toMatchInlineSnapshot(`
    [
      {
        "one": 1,
      },
    ]
  `)

  await db.close()
})
