import * as pgtmp from '@pg-nano/pg-tmp'
import { test } from 'bun:test'
import { postgres, select } from 'yiss'
import { bunAdapter } from './index.ts'

test('bun', async () => {
  const instance = await pgtmp.start({ host: 'localhost' })

  try {
    const db = postgres(new Bun.SQL(instance.dsn), bunAdapter)

    console.log(await db.query(select({ one: 1 })))

    await db.close()
  } finally {
    await instance.stop()
  }
})
