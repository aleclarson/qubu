import { expect, expectTypeOf, test } from 'vitest'
import * as runtime from '../src/index.ts'
import { qubu } from 'qubu/vite'
import { qubuGlobals } from '../src/vite/globals.ts'

test('keeps the global catalog aligned with runtime exports', () => {
  const exports = runtime as Record<string, unknown>
  expect(qubuGlobals.every(name => name in exports)).toBe(true)
})

test('injects only referenced Qubu globals after the directive prologue', () => {
  const plugin = qubu()
  const result = plugin.transform(
    `"use strict";
"use qubu";

const users = table('users', { id: integer(), name: text() });
const query = select({ id: users.id }, from(users), where(eq(users.id, 42)));`,
    '/workspace/query.ts'
  )

  expect(result?.code).toBe(
    `"use strict";
"use qubu";

import { eq, from, integer, select, table, text, where } from "qubu";
const users = table('users', { id: integer(), name: text() });
const query = select({ id: users.id }, from(users), where(eq(users.id, 42)));`
  )
})

test('executes a transformed directive module through the injected runtime imports', () => {
  const plugin = qubu()
  const result = plugin.transform(
    `"use qubu";
const users = table('users', { id: integer(), name: text() });
const query = select({ id: users.id }, from(users), where(eq(users.id, 42)));
const rendered = render(query);`,
    '/workspace/query.ts'
  )
  const importLine = result?.code
    .split('\n')
    .find(line => line.startsWith('import '))
  const names = importLine?.match(/\{ (.+) \}/)?.[1].split(', ') ?? []
  const executable =
    result?.code.replace(`${importLine}\n`, '') + '\nreturn rendered'
  const run = Function(...names, executable) as (...values: unknown[]) => {
    text: string
    parameters: readonly unknown[]
  }
  const values = names.map(name => (runtime as Record<string, unknown>)[name])

  expect(run(...values)).toEqual({
    text: 'SELECT "users"."id" AS "id" FROM "users" WHERE ("users"."id" = ?)',
    parameters: [42],
  })
})

test('ignores strings, comments, and member properties', () => {
  const plugin = qubu()
  const result = plugin.transform(
    `"use qubu";
const text = "select(table)";
const object = { select: true, table: true };
object.select;`,
    '/workspace/query.ts'
  )

  expect(result).toBeNull()
})

test('does not duplicate names already bound by an import', () => {
  const plugin = qubu()
  const result = plugin.transform(
    `"use qubu";
import { select } from 'qubu';
const users = table('users', { id: integer() });
select({ id: users.id }, from(users));`,
    '/workspace/query.ts'
  )

  expect(result?.code).toContain(`import { from, integer, table } from "qubu";`)
  expect(result?.code).not.toContain(
    `import { select, table, integer, from } from "qubu";`
  )
})

test('auto-imports the SQL template tag', () => {
  const result = qubu().transform(
    '"use qubu"; const predicate = sql`id = ${42}`;',
    '/workspace/query.ts'
  )

  expect(result?.code).toContain('import { sql } from "qubu";')
})

test('exposes ambient Qubu value types', () => {
  const typedTable: typeof table = undefined as never
  const typedSelect: typeof select = undefined as never
  const typedExecuteRows: typeof executeRows = undefined as never
  const typedJsonPath: typeof jsonPath = undefined as never
  const typedCheck: typeof check = undefined as never
  const typedForeignKey: typeof foreignKey = undefined as never
  const typedIndex: typeof index = undefined as never
  const typedReferences: typeof references = undefined as never
  const typedSql: typeof sql = undefined as never
  const ambientSqlTag: SqlTag = undefined as never
  const ambientTypedSqlTag: TypedSqlTag<string, SqlText> = undefined as never

  expectTypeOf(typedTable).toBeFunction()
  expectTypeOf(typedSelect).toBeFunction()
  expectTypeOf(typedExecuteRows).toBeFunction()
  expectTypeOf(typedJsonPath).toBeFunction()
  expectTypeOf(typedCheck).toBeFunction()
  expectTypeOf(typedForeignKey).toBeFunction()
  expectTypeOf(typedIndex).toBeFunction()
  expectTypeOf(typedReferences).toBeFunction()
  expectTypeOf(typedSql).toBeFunction()
  expectTypeOf(ambientSqlTag).toBeFunction()
  expectTypeOf(ambientTypedSqlTag).toBeFunction()
})

test('supports filters and ignores non-script modules', () => {
  const plugin = qubu({ include: id => id.includes('/src/') })
  const source = `"use qubu"; select({ value: value(1) });`

  expect(plugin.transform(source, '/workspace/src/query.ts')).not.toBeNull()
  expect(plugin.transform(source, '/workspace/query.ts')).toBeNull()
  expect(plugin.transform(source, '/workspace/src/query.css')).toBeNull()
  expect(
    plugin.transform(source, '/workspace/node_modules/example.ts')
  ).toBeNull()
})
