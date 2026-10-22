import { expect, test } from "vitest"

import { mysqlDialect } from "../src/dialects/mysql.ts"
import { postgresDialect } from "../src/dialects/postgres.ts"
import { integer, isDistinctFrom, isNotDistinctFrom, render, table } from "../src/index.ts"

const records = table("audit_nullable_records", { id: integer({ nullable: true }) })

test("renders MySQL null-safe equality with its supported comparison operator", () => {
  // MySQL <=> is equivalent to SQL IS NOT DISTINCT FROM.
  // https://dev.mysql.com/doc/refman/8.4/en/comparison-operators.html
  expect(render(isNotDistinctFrom(records.id, null), mysqlDialect())).toEqual({
    text: "(`audit_nullable_records`.`id` <=> ?)",
    parameters: [null],
  })
})

test("renders MySQL null-safe inequality through a negated comparison", () => {
  const rendered = render(isDistinctFrom(records.id, 1), mysqlDialect())

  expect(rendered.text).toContain("<=>")
  expect(rendered.text).toMatch(/\bNOT\b/u)
  expect(rendered.text).not.toContain("IS DISTINCT FROM")
  expect(rendered.parameters).toEqual([1])
})

test("retains PostgreSQL standard null-safe comparison syntax", () => {
  expect(render(isNotDistinctFrom(records.id, null), postgresDialect())).toEqual({
    text: '("audit_nullable_records"."id" IS NOT DISTINCT FROM $1)',
    parameters: [null],
  })
  expect(render(isDistinctFrom(records.id, 1), postgresDialect())).toEqual({
    text: '("audit_nullable_records"."id" IS DISTINCT FROM $1)',
    parameters: [1],
  })
})
