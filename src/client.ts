import { ClientAdapter } from './adapter.ts'
import { SQL } from './core.ts'
import {
  PgIdent,
  PgParam,
  PgSequence,
  PgSyntax,
  SQLAlias,
  SQLTokens,
} from './symbols.ts'
import { comma, isToken, sequence, Token } from './tokens.ts'

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

  async query<T extends SQL.Query>(...queries: [...SQL.Subquery[], T]) {
    const lastQuery = queries.pop() as T
    const tokens = queries.length
      ? [
          'with',
          subquerySequence(queries as SQL.Subquery[]),
          ...lastQuery[SQLTokens],
        ]
      : lastQuery[SQLTokens]

    const params: unknown[] = []
    const sql = renderTokens(tokens, params)
    console.log('query', { sql, params })

    await this.connect()
    console.log('connected')

    return this.adapter.query(this.client, sql, params) as Promise<
      SQL.InferOutput<T>
    >
  }
}

function subquerySequence(queries: SQL.Subquery[]) {
  return sequence(
    queries.map(query => {
      return sequence([query[SQLAlias][PgIdent], 'as', query[SQLTokens]])
    }),
    comma
  )
}

function renderTokens(tokens: Token[], params: unknown[]): string {
  let sql = ''
  for (const token of tokens) {
    if (sql.length) sql += ' '
    sql += renderToken(token, params)
  }
  return sql
}

function renderToken(token: Token, params: unknown[]): string {
  if (typeof token === 'string') {
    return token
  }
  if (isToken(token, PgParam)) {
    const index = 1 + params.indexOf(token[PgParam])
    return '$' + (index || params.push(token[PgParam]))
  }
  if (isToken(token, PgSequence)) {
    let sequence = ''
    for (let i = 0; i < token[PgSequence].length; i++) {
      if (i > 0) sequence += token.separator[PgSyntax]
      sequence += renderToken(token[PgSequence][i], params)
    }
    return sequence
  }
  if (token instanceof SQL.Subquery) {
    return token[SQLAlias][PgIdent] // Subquery reference
  }
  if (token instanceof SQL.Query) {
    return renderTokens(token[SQLTokens], params)
  }
  return '(' + renderTokens(token, params) + ')'
}
