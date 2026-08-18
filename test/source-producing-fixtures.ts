import {
  aliasExpression,
  count,
  customSource,
  eq,
  from,
  groupBy,
  identifier,
  integer,
  leftJoin,
  select,
  table,
  text,
  where,
} from '../src/index.ts'

export const users = table('users', {
  id: integer(),
})

export const entries = customSource({
  identity: {
    sourceKind: 'table-function',
    name: 'json_each',
    alias: 'entry',
  },
  sourceKind: 'table-function',
  reference: identifier('entry'),
  columns: {
    key: integer(),
    value: text({ nullable: true }),
  },
  render(context) {
    context.append('json_each(')
    context.parameter('{"a":1}')
    context.append(') AS ')
    context.render(identifier('entry'))
  },
})

export const entriesQuery = select(
  {
    key: entries.key,
    value: entries.value,
  },
  from(entries),
  where(eq(entries.key, 7))
)

export const joinedEntriesClause = leftJoin(entries, eq(users.id, entries.key))

export const joinedEntriesQuery = select(
  {
    userId: users.id,
    value: entries.value,
    total: aliasExpression(count(entries.key), 'total'),
  },
  from(users),
  joinedEntriesClause,
  groupBy(users.id, entries.value)
)
