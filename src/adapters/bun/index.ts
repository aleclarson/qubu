import { ClientAdapter } from '../adapter.ts'

export const bunAdapter: ClientAdapter<Bun.SQL> = {
  connect: client => client.connect(),
  close: client => client.close(),
  query: (client, sql, params) => client.unsafe(sql, params),
}
