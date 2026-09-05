# `@qubu/pgvector`

Typed PostgreSQL `pgvector` columns and nearest-neighbor expressions for Qubu.

```ts
import { asc, fetchFirst, from, integer, orderBy, render, select, table } from "qubu"
import { pgvector } from "@qubu/pgvector"

const items = table("items", {
  id: integer(),
  embedding: pgvector.vector(3),
})

const distance = pgvector.cosineDistance(items.embedding, [0.1, 0.2, 0.3])
const query = select(
  { id: items.id, distance },
  from(items),
  orderBy(asc(distance)),
  fetchFirst(10),
)

render(query, pgvector.dialect())
```

Add an approximate nearest-neighbor index through the table metadata callback:

```ts
const items = table("items", { embedding: pgvector.vector(1536) }, (table) => ({
  constraints: {},
  indexes: {
    embeddingCosine: pgvector.index(table.embedding, { distance: "cosine" }),
  },
}))
```

The index helper defaults to HNSW and can use `method: "ivfflat"` with PostgreSQL storage
parameters when that tradeoff is appropriate.

`vector(n)` validates dimensions and finite components at runtime. Column writes are encoded as
pgvector text (`[1,2,3]`), and selected text values are decoded back to numeric arrays. The distance
operators preserve pgvector's index-friendly ordering form. Use `pgvector.dialect()` when rendering
or executing a query that contains one of these operators.

The PostgreSQL `vector` extension must already be installed in the database. The package currently
covers dense `vector(n)` values and L2, inner-product, cosine, and L1 distance; half, binary, and
sparse vector types can be added as separate typed surfaces when needed.
