import { fileURLToPath } from "node:url"

import ts from "typescript"
import { expect, test } from "vitest"

const root = fileURLToPath(new URL("../", import.meta.url))
const config = ts.readConfigFile(`${root}tsconfig.json`, ts.sys.readFile)
const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, root)

test.each([
  {
    name: "ES only",
    dom: false,
    node: false,
  },
  {
    name: "DOM",
    dom: true,
    node: false,
  },
  {
    name: "Node",
    dom: false,
    node: true,
  },
  {
    name: "Node and DOM",
    dom: true,
    node: true,
  },
])("compiles an isolated entry point with $name types", ({ dom, node }) => {
  // A single root reproduces tools that do not load tsconfig's included files.
  const program = ts.createProgram([`${root}src/index.ts`], {
    ...options,
    lib: ["lib.esnext.d.ts", ...(dom ? ["lib.dom.d.ts"] : [])],
    types: node ? ["node"] : [],
    typeRoots: [`${root}node_modules/@types`],
    skipLibCheck: false,
    noEmit: true,
  })
  const diagnostics = ts.getPreEmitDiagnostics(program)

  expect(
    ts.formatDiagnostics(diagnostics, {
      getCanonicalFileName: (file) => file,
      getCurrentDirectory: () => root,
      getNewLine: () => "\n",
    }),
  ).toBe("")
})
