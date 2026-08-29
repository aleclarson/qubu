import { readFileSync, readdirSync } from "node:fs"
import { extname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import * as migrate from "@qubu/migrate"
import * as ddl from "@qubu/migrate/ddl"
import * as plan from "@qubu/migrate/plan"
import { expect, test } from "vitest"

const packageRoot = resolve(fileURLToPath(new URL("..", import.meta.url)))

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)

    if (entry.isDirectory()) {
      return sourceFiles(path)
    }

    return extname(path) === ".ts" ? [path] : []
  })
}

test("keeps compiler entrypoints free of Node, database-client, and CLI dependencies", () => {
  expect(Reflect.ownKeys(migrate).length).toBeGreaterThan(0)
  expect(Reflect.ownKeys(plan).length).toBeGreaterThan(0)
  expect(Reflect.ownKeys(ddl).length).toBeGreaterThan(0)

  const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>
  }

  expect(manifest.dependencies).toBeUndefined()

  for (const file of sourceFiles(join(packageRoot, "src"))) {
    const source = readFileSync(file, "utf8")
    const imports = [...source.matchAll(/\b(?:from|import)\s*(?:\(\s*)?["']([^"']+)["']/g)].map(
      (match) => match[1],
    )

    expect(imports, file).not.toContainEqual(expect.stringMatching(/^node:/))
    expect(imports, file).not.toContainEqual(expect.stringMatching(/^@qubu\/adapter-/))
    expect(imports, file).not.toContain("@alloc/cmd-ts")
  }
})
