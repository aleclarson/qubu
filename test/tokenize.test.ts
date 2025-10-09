import { expect, test } from "vitest";
import {
  and,
  from,
  integer,
  isEqual,
  isNotNull,
  pgTable,
  select,
  text,
  where,
} from "yiss";
import { tokenize } from "../src/tokens.ts";

test("select query", () => {
  const users = pgTable("users", {
    id: integer().primaryKey(),
    name: text(),
  });

  expect(
    tokenize([
      select({ id: 1, name: "Bruno" }),
      from(users),
      where(users.id, isEqual(1), and(users.name, isNotNull())),
    ])
  ).toMatchInlineSnapshot();
});
