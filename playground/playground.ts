/**
 * A runnable scratchpad for getting a feel for Qubu.
 *
 * Run it: npm run playground Type-check it: npm run typecheck:playground
 *
 * This directory's tsconfig maps `qubu` to ../src, so edits to the library are reflected here
 * immediately without rebuilding dist.
 */
import {
  all,
  count,
  cte,
  desc,
  eq,
  fetchFirst,
  from,
  groupBy,
  gt,
  having,
  insertInto,
  integer,
  leftJoin,
  offset,
  orderBy,
  over,
  render,
  returning,
  rowNumber,
  select,
  sum,
  table,
  text,
  update,
  values,
  where,
  withCte,
  type RenderedQuery,
} from "qubu"
import { ilike, postgresDialect } from "qubu/postgres"
import { sqliteDialect } from "qubu/sqlite"

// Schema definitions are both SQL sources and the source of Qubu's types.
const users = table("users", {
  id: integer({ generated: true }),
  organizationId: integer(),
  name: text(),
  email: text({
    nullable: true,
    hasDefault: true,
  }),
})

const posts = table("posts", {
  id: integer({ generated: true }),
  authorId: integer(),
  title: text(),
  views: integer({ hasDefault: true }),
})

// Clauses are ordinary values. Their argument order does not determine SQL
// order, so reusable filters and ordering can be assembled separately.
const interestingUsers = where(ilike(users.name, "%a%"))
const alphabetical = orderBy(users.name)

const userPage = select(
  {
    id: users.id,
    displayName: users.name,
    email: users.email,
  },
  from(users),
  interestingUsers,
  alphabetical,
  fetchFirst(10),
  offset(20),
)

// Hover this alias, or change the sample value, to explore inferred row types.
type UserPageRow = typeof userPage.row
const sampleUser: UserPageRow = {
  id: 1,
  displayName: "Ada",
  email: null,
}

void sampleUser

// A left join automatically makes fields from the joined source nullable.
const usersWithPosts = select(
  {
    user: users.name,
    post: posts.title,
  },
  from(users),
  leftJoin(posts, eq(users.id, posts.authorId)),
  orderBy(desc(posts.id)),
)

// Aggregates retain their source dependencies. Qubu checks that every plain
// selected column is represented in GROUP BY.
const postStats = select(
  {
    authorId: posts.authorId,
    postCount: count(posts.id),
    totalViews: sum(posts.views),
  },
  from(posts),
  groupBy(posts.authorId),
  having(gt(count(posts.id), 0)),
  orderBy(desc(sum(posts.views))),
)

// Window functions remain normal typed expressions in the projection.
const rankedPosts = select(
  {
    id: posts.id,
    authorId: posts.authorId,
    rankWithinAuthor: over(rowNumber(), {
      partitionBy: [posts.authorId],
      orderBy: [desc(posts.views)],
    }),
  },
  from(posts),
)

// A query's inferred output becomes the schema of a CTE.
const prolificAuthors = cte(
  "prolific_authors",
  select(
    {
      authorId: posts.authorId,
      postCount: count(posts.id),
    },
    from(posts),
    groupBy(posts.authorId),
    having(gt(count(posts.id), 2)),
  ),
)

const prolificAuthorNames = select(
  {
    name: users.name,
    postCount: prolificAuthors.postCount,
  },
  withCte(prolificAuthors),
  from(users),
  leftJoin(prolificAuthors, eq(users.id, prolificAuthors.authorId)),
)

// Write inputs follow generated/default/nullable column metadata. RETURNING
// gives a mutation the same typed `row` property as a select query.
const addUsers = insertInto(
  users,
  values(
    {
      organizationId: 10,
      name: "Ada",
      email: "ada@example.com",
    },
    {
      organizationId: 10,
      name: "Grace",
      email: null,
    },
  ),
  returning({
    id: users.id,
    name: users.name,
  }),
)

const renameUser = update(
  users,
  { name: "Augusta Ada King" },
  where(eq(users.id, 1)),
  returning(all(users)),
)

// Rendering is a separate boundary: the same portable query can target
// different placeholder and pagination policies. `userPage` uses PostgreSQL's
// ILIKE capability, so Qubu prevents rendering it with SQLite. Try replacing
// ilike() above with like() to make the query portable.
const examples: ReadonlyArray<readonly [string, RenderedQuery]> = [
  ["user page (PostgreSQL)", render(userPage, postgresDialect())],
  ["users with posts (SQLite)", render(usersWithPosts, sqliteDialect())],
  ["post stats", render(postStats)],
  ["ranked posts", render(rankedPosts)],
  ["CTE composition", render(prolificAuthorNames)],
  ["insert with returning", render(addUsers)],
  ["safe update with returning", render(renameUser)],
]

for (const [label, statement] of examples) {
  console.log(`\n--- ${label} ---`)
  console.log(statement.text)
  console.log(statement.parameters)
}

// Uncomment experiments like these and run the type-checker to see Qubu's
// safety rails in action:
//
// select({ name: users.name })
// update(users, { name: 'No WHERE clause' })
// render(userPage, sqliteDialect())
