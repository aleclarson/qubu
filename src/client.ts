import { QubuAdapter } from './adapter.ts'
import { renderTokens, seq, SQL } from './core.ts'
import { PgIdent, PgSequence, SQLAlias } from './core/symbols.ts'

/**
 * Wrap a query driver with a Qubu adapter.
 */
export function qubu<TDriver>(driver: TDriver, adapter: QubuAdapter<TDriver>) {
  return new QueryClient(driver, adapter)
}

export class QueryClient {
  protected connected: Promise<void> | null = null
  constructor(
    protected readonly driver: unknown,
    protected readonly adapter: QubuAdapter<unknown>
  ) {}

  /**
   * Connect to the database. This is called automatically when the
   * first query is executed, but you can call it manually if you want
   * to establish the connection early. Connection pooling must be
   * implemented by the underlying client.
   */
  async connect() {
    await (this.connected ||= this.adapter.connect(this.driver))
  }

  async close() {
    await this.connected?.then(() => this.adapter.close(this.driver))
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

    return this.adapter.query(this.driver, sql, params) as Promise<
      SQL.InferOutput<T>
    >
  }
}

function subquerySequence(queries: SQL.QueryIdentifier[]) {
  return seq(
    queries.map(query => {
      return seq([query[SQLAlias][PgIdent], 'as', query[PgSequence]])
    }),
    ', '
  )
}
