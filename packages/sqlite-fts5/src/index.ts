import { dialect } from "./dialect.ts"
import { bm25, highlight, match, snippet } from "./query.ts"
import { add, create, normalize } from "./snapshot.ts"
import { fts5Capability, table } from "./table.ts"

/** Namespace-first public API for SQLite FTS5 support. */
export const fts5 = Object.freeze({
  capability: fts5Capability,
  table,
  match,
  bm25,
  highlight,
  snippet,
  dialect,
  snapshot: Object.freeze({
    create,
    add,
    normalize,
  }),
})

export type {
  Fts5Capability,
  Fts5ColumnDescriptor,
  Fts5ColumnMap,
  Fts5ColumnSpec,
  Fts5Definition,
  Fts5Detail,
  Fts5ExternalContent,
  Fts5Identity,
  Fts5Row,
  Fts5Source,
  Fts5SqlTypes,
  Fts5SyncMode,
  Fts5TableOptions,
} from "./table.ts"
export type { Fts5MatchExpression, Fts5RankExpression, Fts5TextExpression } from "./query.ts"
