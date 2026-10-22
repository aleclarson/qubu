import { expect, test } from "vitest"

import * as runtime from "../src/index.ts"
import { qubu as qubuPlugin } from "../src/vite/index.ts"

function executeTransformed(source: string) {
  const result = qubuPlugin().transform(source, "/workspace/query.js")

  expect(result).not.toBeNull()
  const code = result!.code
  const importLine = code.split("\n").find((line) => line.startsWith("import "))
  const names = importLine?.match(/\{ (.+) \}/)?.[1].split(", ") ?? []
  const executable = code.replace(`${importLine}\n`, "") + "\nreturn rendered"
  const run = Function(...names, executable)

  return run(...names.map((name) => (runtime as Record<string, unknown>)[name]))
}

test("imports Qubu references inside SQL template substitutions", () => {
  const rendered = executeTransformed(
    '"use qubu";\nconst fragment = sql`SELECT ${value(42)} AS answer`;\nconst rendered = render(fragment);',
  )

  expect(rendered).toEqual({
    text: "SELECT ? AS answer",
    parameters: [42],
  })
})

test("imports a module reference shadowed only by an unrelated function parameter", () => {
  const rendered = executeTransformed(`"use qubu";
function identity(select) { return select; }
const query = select({ answer: value(42) });
const rendered = render(query);`)

  expect(rendered).toEqual({
    text: 'SELECT ? AS "answer"',
    parameters: [42],
  })
})
