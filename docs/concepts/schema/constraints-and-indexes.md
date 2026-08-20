# Constraints, keys, and indexes

> Record database constraints and indexes when Qubu needs them to check foreign keys or grouped query projections.

## Declare constraints and indexes

Pass a metadata callback to `table()` when the application schema knows which
rules the database enforces:

```ts
import {
  check,
  eq,
  foreignKey,
  index,
  integer,
  primaryKey,
  references,
  table,
  text,
  unique,
  value,
} from 'qubu'

const accounts = table(
  'accounts',
  { id: integer(), slug: text() },
  accounts => ({
    constraints: {
      accountsPrimary: primaryKey(accounts.id),
    },
    indexes: {
      accountsSlug: index([accounts.slug], { unique: true }),
    },
  })
)

const memberships = table(
  'memberships',
  {
    id: integer(),
    accountId: integer(),
    slug: text(),
    displayName: text(),
  },
  memberships => ({
    constraints: {
      membershipsPrimary: primaryKey(memberships.id),
      membershipsUnique: unique(memberships.accountId, memberships.slug),
      membershipsAccount: foreignKey(
        [memberships.accountId],
        references(accounts, accounts.id)
      ),
      membershipsCheck: check(eq(memberships.slug, value('public'))),
    },
    indexes: {
      membershipsAccountSlug: index([memberships.accountId, memberships.slug], {
        unique: true,
      }),
    },
  })
)
```

The callback receives the preliminary table, including its typed columns. Give
each item a stable application name in the constraints or indexes record. The
record key becomes `constraint.id` or `index.id`. Qubu resolves `physicalName` from
the explicit option or the version-one snake_case policy.

Index terms may use `asc()` or `desc()`. Set `unique: true` for a unique index,
`where` for a partial index, and `include` for columns stored in the index payload but not
used as key terms.

## Distinguish candidate keys from unique constraints

`unique()` describes a non-null candidate key. Qubu can use it to prove that a
grouped key determines other columns. Every key column must belong to the
callback table and be non-nullable.

Use `uniqueConstraint()` when the database enforces uniqueness but the rule should
not prove a functional dependency:

```ts
import { table, text, uniqueConstraint } from 'qubu'

const accounts = table(
  'accounts',
  { email: text({ nullable: true }) },
  accounts => ({
    constraints: {
      emailUnique: uniqueConstraint(accounts.email, {
        nulls: 'distinct',
        physicalName: 'accounts_email_key',
      }),
    },
    indexes: {},
  })
)
```

`nulls: 'distinct'` describes the common rule where multiple NULLs do not
conflict. `'not-distinct'` describes a rule where NULL participates in the
comparison. Neither form proves that a grouped column determines the rest of a
row.

## Add foreign keys

`foreignKey(localColumns, target, options)` accepts single or composite tuples.
Build the target with `references(table, ...columns)`. The tuples must have the
same length and matching known `SqlSemanticType` identities. `SqlUnknown` cannot
prove a foreign-key match.

The target tuple must exactly match a primary key, unique() constraint, or
eligible unique index. Options such as onUpdate, onDelete, match, deferrable,
and initially remain metadata:

```ts
const memberships = table(
  'memberships',
  { accountId: integer() },
  memberships => ({
    constraints: {
      accountForeign: foreignKey(
        [memberships.accountId],
        references(accounts, accounts.id),
        { onDelete: 'cascade', onUpdate: 'cascade' }
      ),
    },
    indexes: {},
  })
)
```

Use the preliminary callback table for direct self-references. Wrap the target
in a function when two modules import each other's tables.

Checks, index expressions, and partial-index predicates may read only columns
from their callback table. They cannot contain aggregates, window functions, or
subqueries. Check expressions and partial predicates must have the boolean SQL
domain.

## Use key metadata for grouped queries

Grouping every column in a declared candidate key lets Qubu select other
columns from that source:

```ts
import { count, from, groupBy, select } from 'qubu'

const summary = select(
  { displayName: memberships.displayName, total: count() },
  from(memberships),
  groupBy(memberships.accountId, memberships.slug)
)
```

A primary key, `unique()` constraint, or eligible unique index supplies the
proof. A partial index, expression index, nullable key, or included column does
not silently become candidate-key evidence.

The proof follows a table alias and remains source-local through a join,
including a source made nullable by `leftJoin()`. It does not cross a derived
query, CTE, LATERAL query, or custom-source boundary. Those relations need an
explicit proof on their own source model.

## Store dialect-specific metadata

Index methods, operator classes, concurrency, storage parameters, and
MySQL-specific algorithm or locking settings belong in the typed dialect
extension on an index. Constraint extensions follow the same pattern. A
dialect validator reports an error when the selected engine does not support an
extension.

## Read next

- [Column behavior and write types](columns-and-writes.md) covers metadata
  attached to individual columns.
- [Storage and schema SQL](storage-and-schema-sql.md) covers physical storage
  and deterministic expressions.
- [SQL semantic types](../sql-semantic-types.md) explains type compatibility.
