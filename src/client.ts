import { ClientAdapter } from './adapter.ts'
import { renderTokens, SQL } from './core.ts'
import { PgIdent, PgSequence, SQLAlias } from './core/symbols.ts'
import { comma, seq } from './core/tokens.ts'

export function postgres<TClient>(
  client: TClient,
  adapter: ClientAdapter<TClient>
) {
  return new PgDatabase(client, adapter)
}

export class PgDatabase {
  protected connected: Promise<void> | null = null
  constructor(
    protected readonly client: unknown,
    protected readonly adapter: ClientAdapter<unknown>
  ) {}

  /**
   * Connect to the database. This is called automatically when the
   * first query is executed, but you can call it manually if you want
   * to establish the connection early. Connection pooling must be
   * implemented by the underlying client.
   */
  async connect() {
    await (this.connected ||= this.adapter.connect(this.client))
  }

  async close() {
    await this.connected?.then(() => this.adapter.close(this.client))
    this.connected = null
  }

  async query<T extends SQL.Query>(...queries: [...SQL.QueryIdentifier[], T]) {
    const lastQuery = queries.pop() as T
    const tokens = queries.length
      ? [
          'with',
          subquerySequence(queries as SQL.QueryIdentifier[]),
          ...lastQuery[PgSequence],
        ]
      : lastQuery[PgSequence]

    const params: unknown[] = []
    const sql = renderTokens(tokens, params)

    await this.connect()

    return this.adapter.query(this.client, sql, params) as Promise<
      SQL.InferOutput<T>
    >
  }
}

function subquerySequence(queries: SQL.QueryIdentifier[]) {
  return seq(
    queries.map(query => {
      return seq([query[SQLAlias][PgIdent], 'as', query[PgSequence]])
    }),
    comma
  )
}
