# `@qubu/sqlite-fts5`

> Declare, query, snapshot, and migrate SQLite FTS5 virtual tables while keeping FTS5-specific SQL outside Qubu's portable core.

SQLite FTS5 support for Qubu, kept as an addon because FTS5 is a SQLite virtual-table module rather
than portable relational DDL.

The public API is namespace-first:

```ts
import {
  asc,
  eq,
  from,
  innerJoin,
  integer,
  orderBy,
  render,
  schema,
  select,
  table,
  text,
  where,
} from "qubu"
import { fts5 } from "@qubu/sqlite-fts5"

const documents = table("documents", {
  id: integer(),
  title: text(),
  body: text(),
})

const search = fts5.table({
  name: "documents_fts",
  content: documents,
  contentRowid: documents.id,
  columns: {
    title: documents.title,
    body: documents.body,
  },
  prefix: [2, 3],
})

const query = select(
  {
    id: documents.id,
    title: documents.title,
    rank: fts5.bm25(search),
    excerpt: fts5.highlight(search, "body", "<mark>", "</mark>"),
  },
  from(documents),
  innerJoin(search, eq(documents.id, search.rowid)),
  where(fts5.match(search, "SQLite search")),
  orderBy(asc(fts5.bm25(search))),
)

render(query, fts5.dialect())
```

`fts5.match()` binds the search string as a query parameter. `fts5.bm25()` follows SQLite's
lower-is-better ranking convention. `fts5.highlight()` and `fts5.snippet()` use the FTS5 column
ordinal internally, so callers use the typed field name instead of repeating an index.

FTS5 sources are not ordinary `Table`s. Add them to a SQLite snapshot explicitly:

```ts
const expected = fts5.snapshot.create(schema({ documents }), [search])
```

The optional migration entrypoint supplies the virtual-table, initial backfill, synchronization
triggers, and drop/recreate statements as reviewed custom programs:

```ts
import { fts5Migration } from "@qubu/sqlite-fts5/migration"

const result = fts5Migration.compile(plan)
```

External-content tables use synchronization triggers by default. Use `sync: "manual"` when the
application owns indexing and backfills. Inline and contentless FTS5 tables are also supported;
contentless tables require callers to maintain their index rows directly.

FTS5 must be available in the SQLite build used by the adapter. The addon does not change or
replace Qubu's database adapters.
