import {
  distinct,
  distinctOn,
  from,
  select,
  selectDistinct,
  selectDistinctOn,
  SQL,
} from 'qubu'
import { expect, test } from 'vitest'
import { posts, users } from './common/schema.ts'

const { toString } = SQL.Query

test('Select all columns (SELECT *)', () => {
  const query = select(users.$getAll(), from(users))
  expect(toString(query)).toMatchInlineSnapshot(`
    [
      "select users.* from users",
      [],
    ]
  `)
})

test('Select specific columns', () => {
  const query = select(users.id, users.name, from(users))
  expect(toString(query)).toMatchInlineSnapshot(`
    [
      "select users.id, users.name from users",
      [],
    ]
  `)
})

test('Select with table alias', () => {
  const u = users.as('u')
  const query = select(u.name, from(u))
  expect(toString(query)).toMatchInlineSnapshot(`
    [
      "select u.name from users as u",
      [],
    ]
  `)
})

test('Select from multiple tables', () => {
  const query = select(users.name, posts.body, from(users, posts))
  expect(toString(query)).toMatchInlineSnapshot(`
    [
      "select users.name, posts.body from users, posts",
      [],
    ]
  `)
})

test('Select with column aliases (AS)', () => {
  const query = select(users.name.as('username'), from(users))
  expect(toString(query)).toMatchInlineSnapshot(`
    [
      "select users.name as username from users",
      [],
    ]
  `)
})

test('DISTINCT queries', () => {
  let query = selectDistinct(users.name, from(users))
  expect(toString(query)).toMatchInlineSnapshot(`
    [
      "select distinct users.name from users",
      [],
    ]
  `)

  query = select(distinct(), users.$getAll(), from(users))
  expect(toString(query)).toMatchInlineSnapshot(`
    [
      "select distinct users.* from users",
      [],
    ]
  `)

  query = selectDistinctOn([users.name], users.$getAll(), from(users))
  expect(toString(query)).toMatchInlineSnapshot(`
    [
      "select distinct on (name) users.* from users",
      [],
    ]
  `)

  query = select(distinctOn(users.name), users.$getAll(), from(users))
  expect(toString(query)).toMatchInlineSnapshot(`
    [
      "select distinct on (name) users.* from users",
      [],
    ]
  `)
})
