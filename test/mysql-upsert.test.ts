import { expect, test } from "vitest"

import { incoming, mysqlDialect, onDuplicateKeyUpdate } from "../src/dialects/mysql.ts"
import { postgresDialect } from "../src/dialects/postgres.ts"
import {
  defaultValues,
  from,
  insertInto,
  insertSelect,
  integer,
  omit,
  render,
  select,
  table,
  upper,
  text,
  values,
} from "../src/index.ts"

const accounts = table("accounts", {
  id: integer(),
  displayName: text({
    codec: {
      toDriver: (input: string) => input.toUpperCase(),
      fromDriver: (input: unknown) => String(input).toLowerCase(),
    },
  }),
  version: integer(),
  generated: integer({ generated: true }),
})
const row = {
  id: 1,
  displayName: "Ada",
  version: 1,
}

test("renders incoming aliases, target expressions, physical names and encoded assignments", () => {
  const query = insertInto(
    accounts,
    values(row, {
      ...row,
      id: 2,
    }),
    onDuplicateKeyUpdate(accounts, {
      displayName: incoming(accounts).displayName,
      version: accounts.version,
    }),
  )
  const rendered = render(query, mysqlDialect())

  expect(rendered.parameterSqlTypes).toHaveLength(rendered.parameters.length)
  expect(rendered).toEqual({
    text: "INSERT INTO `accounts` (`id`, `display_name`, `version`) VALUES (?, ?, ?), (?, ?, ?) AS `__qubu_incoming` ON DUPLICATE KEY UPDATE `display_name` = `__qubu_incoming`.`display_name`, `version` = `accounts`.`version`",
    parameters: [1, "ADA", 1, 2, "ADA", 1],
    parameterSqlTypes: ["integer", "text", "integer", "integer", "text", "integer"],
  })
  expect(
    render(
      insertInto(
        accounts,
        values(row),
        onDuplicateKeyUpdate(accounts, {
          displayName: "Grace",
          version: omit,
        }),
      ),
      mysqlDialect(),
    ).parameters,
  ).toEqual([1, "ADA", 1, "GRACE"])
  expect(() => render(query as any, postgresDialect())).toThrow(/on-duplicate-key-update/)
})

test("rejects empty, generated, unknown and mismatched-target assignments", () => {
  for (const assignments of [{}, { version: omit }, { generated: 2 }, { absent: 1 }]) {
    expect(() => onDuplicateKeyUpdate(accounts, assignments as any)).toThrow()
  }

  const other = table("other", {
    id: integer(),
    displayName: text(),
    version: integer(),
  })

  expect(() =>
    insertInto(accounts, values(row), onDuplicateKeyUpdate(other, { version: 2 }) as any),
  ).toThrow(/same INSERT target/)
  const clause = onDuplicateKeyUpdate(accounts, { version: 2 })

  expect(() => insertInto(accounts, values(row), clause, clause)).toThrow(/one conflict clause/)
  expect(() => render(incoming(accounts).displayName as any, mysqlDialect())).toThrow(
    /same target table/,
  )
  expect(() =>
    render(
      insertInto(
        accounts,
        values(row),
        onDuplicateKeyUpdate(accounts, { displayName: incoming(other).displayName } as any),
      ),
      mysqlDialect(),
    ),
  ).toThrow(/same target table/)
})

test("maps INSERT SELECT projected names to incoming target columns", () => {
  const source = table("changes", {
    externalId: integer(),
    label: text(),
    revision: integer(),
  })
  const query = insertInto(
    accounts,
    insertSelect(
      select(
        {
          externalId: source.externalId,
          label: source.label,
          revision: source.revision,
        },
        from(source),
      ),
      ["id", "displayName", "version"],
    ),
    onDuplicateKeyUpdate(accounts, { displayName: incoming(accounts).displayName }),
  )

  expect(render(query, mysqlDialect()).text).toBe(
    "INSERT INTO `accounts` (`id`, `display_name`, `version`) SELECT * FROM (SELECT `__qubu_insert_source`.`external_id` AS `id`, `__qubu_insert_source`.`label` AS `display_name`, `__qubu_insert_source`.`revision` AS `version` FROM (SELECT `changes`.`external_id` AS `external_id`, `changes`.`label` AS `label`, `changes`.`revision` AS `revision` FROM `changes`) AS `__qubu_insert_source`) AS `__qubu_incoming` ON DUPLICATE KEY UPDATE `display_name` = `__qubu_incoming`.`display_name`",
  )
  const omitted = table("omitted", {
    id: integer(),
    label: text({ hasDefault: true }),
  })

  expect(() =>
    render(
      insertInto(
        omitted,
        insertSelect(select({ id: source.externalId }, from(source)), ["id"]),
        onDuplicateKeyUpdate(omitted, { label: incoming(omitted).label }),
      ),
      mysqlDialect(),
    ),
  ).toThrow(/not projected/)
})

test("renders default rows with MySQL syntax and avoids target alias collisions", () => {
  const defaults = table("__qubu_incoming", { id: integer({ hasDefault: true }) })

  expect(
    render(
      insertInto(
        defaults,
        defaultValues(),
        onDuplicateKeyUpdate(defaults, { id: incoming(defaults).id }),
      ),
      mysqlDialect(),
    ).text,
  ).toBe(
    "INSERT INTO `__qubu_incoming` () VALUES () AS `__qubu_incoming_row` ON DUPLICATE KEY UPDATE `id` = `__qubu_incoming_row`.`id`",
  )
})

test("preserves multiple empty VALUES rows", () => {
  const defaults = table("defaults", {
    id: integer({ generated: true }),
    label: text({ hasDefault: true }),
  })

  expect(
    render(
      insertInto(
        defaults,
        values({}, {}),
        onDuplicateKeyUpdate(defaults, { label: incoming(defaults).label }),
      ),
      mysqlDialect(),
    ).text,
  ).toContain("() VALUES (), () AS")
})

test("composes incoming expressions without applying raw-value encoders", () => {
  const rendered = render(
    insertInto(
      accounts,
      values(row),
      onDuplicateKeyUpdate(accounts, { displayName: upper(incoming(accounts).displayName) }),
    ),
    mysqlDialect(),
  )

  expect(rendered.text).toContain("`display_name` = UPPER(`__qubu_incoming`.`display_name`)")
  expect(rendered.parameters).toEqual([1, "ADA", 1])
})
