# Qubu wow moments

This is a catalog of the moments Qubu should make feel effortless: the code stays close to SQL, while types quietly accumulate the consequences of every composition step.

These examples are design targets and product-facing demonstrations. They should remain short enough to show in a README, talk, or opening documentation page.

## 1. A typed query fits on one screen

The first impression should be ordinary SQL with the ceremony removed—not a maze of generic parameters.

```ts
import {
  desc,
  eq,
  fetchFirst,
  from,
  integer,
  orderBy,
  select,
  table,
  text,
  where,
} from 'qubu'

const users = table('users', {
  id: integer(),
  name: text(),
})

const query = select(
  {
    id: users.id,
    displayName: users.name,
  },
  from(users),
  where(eq(users.id, 42)),
  orderBy(desc(users.name)),
  fetchFirst(20)
)

// inferred row: { id: number; displayName: string }
// inferred SQL parameters: [42, 20]
```

**The feeling:** “I wrote a query, not a type-level program.”

## 2. Invalid scope fails at the point of composition

A column carries the identity of the source that provides it. The compiler can explain a missing `FROM`/`JOIN` source without requiring a manually authored query-state type.

```ts
const posts = table('posts', {
  id: integer(),
  authorId: integer(),
})

select(
  { name: users.name },
  from(posts)
  //       ~~~~~~~~~
  // Type error: users is not available in this query scope
)
```

Adding the missing source fixes the query naturally:

```ts
select(
  { name: users.name },
  from(users),
  innerJoin(posts, eq(users.id, posts.authorId))
)
```

**The feeling:** “The compiler understands the relational mistake, not just the syntax.”

## 3. A CTE becomes a typed table automatically

The output of one query becomes the input surface of the next query without a model declaration or result-shape duplication.

```ts
const activeUsers = cte(
  'active_users',
  select(
    { id: users.id, name: users.name },
    from(users),
    where(isNotNull(users.email))
  )
)

const report = select(
  { displayName: activeUsers.name },
  withCte(activeUsers),
  from(activeUsers)
)

// activeUsers.name is inferred as string
// report.row is inferred as { displayName: string }
```

**The feeling:** “Composition preserves meaning all the way down.”

## 4. Functional inputs can arrive in human order

Clauses are independent values. Qubu emits canonical SQL order without forcing a mutable builder chain or a fragile call sequence.

```ts
const query = select(
  { id: users.id, name: users.name },
  orderBy(desc(users.name)),
  where(eq(users.id, 42)),
  from(users)
)
```

The result still renders as:

```sql
SELECT "users"."id" AS "id", "users"."name" AS "name"
FROM "users"
WHERE ("users"."id" = ?)
ORDER BY "users"."name" DESC
```

**The feeling:** “The API is composable without making SQL order my problem twice.”

## 5. One query, multiple dialect policies

Dialect differences stay at the rendering boundary. Query construction does not fork when the placeholder syntax changes.

```ts
const standardSql = render(query, standardDialect())
const postgresSql = render(query, postgresDialect())

standardSql.text // ... WHERE ("users"."id" = ?)
postgresSql.text // ... WHERE ("users"."id" = $1)
```

**The feeling:** “Portability is explicit policy, not hidden abstraction.”

## 6. Uncommon SQL does not require a central registry

A custom clause can participate in the same composition model as built-ins.

```ts
const fetchWithTies = customClause<never, number>({
  name: 'fetch-with-ties',
  order: 100,
  render(context) {
    context.append('FETCH FIRST ')
    context.parameter(10)
    context.append(' ROWS WITH TIES')
  },
})

const query = select({ id: users.id }, from(users), fetchWithTies)
```

There is no global operator registry, singleton builder, or core change request. The extension supplies a renderer and remains a normal clause value.

**The feeling:** “The escape hatch is composable, typed, and honest.”

## 7. Parameter safety is invisible until it matters

Values look like values in source code and remain bound parameters in the output.

```ts
const search = "O'Reilly"
const query = select(
  { name: users.name },
  from(users),
  where(like(users.name, `%${search}%`))
)

render(query)
// text:       ... WHERE ("users"."name" LIKE ?)
// parameters: ["%O'Reilly%"]
```

The developer gets readable code, stable placeholder ordering, and no string interpolation into SQL.

**The feeling:** “The safe path is also the pleasant path.”

## 8. The runtime core stays small enough to understand

Every fragment is a renderer with semantic type metadata:

```ts
type Fragment<Output, RequiredSources, Parameters> = {
  render(context: RenderContext): void
}
```

That small center makes the rest of Qubu extensible. Expressions, clauses, CTEs, dialects, and user-defined features all compose through the same primitive instead of being forced through an all-encompassing query object.

**The feeling:** “I can understand the engine before I need to extend it.”

## The bar

A new feature earns a place in this catalog when it demonstrates at least one of these qualities:

- SQL remains recognizable.
- The type consequence is inferred rather than manually restated.
- Composition works across function boundaries.
- Dialect differences are explicit and local.
- The safe default is the easiest API to reach for.
- Extensions use small public primitives instead of privileged global machinery.
