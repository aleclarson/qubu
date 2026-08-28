import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  packageRoot,
  readManifest,
  repositoryRoot,
  workspaceChildDirectories,
} from "./workspace-packages.mjs"

const packageManager = process.platform === "win32" ? "pnpm.cmd" : "pnpm"
const npm = process.platform === "win32" ? "npm.cmd" : "npm"

function run(command, args, cwd) {
  execFileSync(command, args, {
    cwd,
    env: process.env,
    stdio: "inherit",
  })
}

function installSpecs(manifests) {
  const specs = new Set()
  const workspaceNames = new Set([
    readManifest(".").name,
    ...manifests.map((manifest) => manifest.name),
  ])

  for (const manifest of manifests) {
    for (const [name, version] of Object.entries(manifest.devDependencies ?? {})) {
      if (!workspaceNames.has(name) && !version.startsWith("workspace:")) {
        specs.add(`${name}@${version}`)
      }
    }
  }

  return [...specs].toSorted()
}

function entrySpecifier(packageName, subpath) {
  return subpath === "." ? packageName : `${packageName}/${subpath.slice(2)}`
}

function validateInstalledPackage(consumerRoot, expectedManifest) {
  const root = join(consumerRoot, "node_modules", ...expectedManifest.name.split("/"))
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))

  assert.equal(manifest.name, expectedManifest.name)
  assert.equal(manifest.repository?.url, "https://github.com/aleclarson/qubu")
  assert.equal(manifest.repository?.directory, expectedManifest.repository?.directory)

  const runtimeSpecifiers = []

  for (const [subpath, descriptor] of Object.entries(manifest.exports ?? {})) {
    if (subpath === "./package.json") {
      assert.equal(descriptor, "./package.json")
      continue
    }

    if (typeof descriptor === "string") {
      assert(statSync(join(root, descriptor)).isFile())
      if (subpath === ".") {
        assert.equal(typeof manifest.types, "string", `${manifest.name} needs types`)
        assert(statSync(join(root, manifest.types)).isFile())
      }
    } else {
      assert.equal(typeof descriptor, "object", `${subpath} must be an export`)
      assert.equal(typeof descriptor.types, "string", `${subpath} needs types`)
      assert.equal(typeof descriptor.import, "string", `${subpath} needs import`)
      assert(statSync(join(root, descriptor.types)).isFile())
      assert(statSync(join(root, descriptor.import)).isFile())
    }

    runtimeSpecifiers.push(entrySpecifier(manifest.name, subpath))
  }

  assert(runtimeSpecifiers.length > 0, `${manifest.name} needs runtime exports`)
  return runtimeSpecifiers
}

const temporaryRoot = mkdtempSync(join(tmpdir(), "qubu-workspace-packages-"))

try {
  const rootTarball = join(temporaryRoot, "qubu.tgz")

  run(packageManager, ["pack", "--out", rootTarball], repositoryRoot)

  const manifests = workspaceChildDirectories.map(readManifest)
  const packageTarballs = workspaceChildDirectories.map((directory, index) => {
    const tarball = join(temporaryRoot, `workspace-package-${index}.tgz`)

    run(packageManager, ["pack", "--out", tarball], packageRoot(directory))
    return tarball
  })

  writeFileSync(
    join(temporaryRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "qubu-workspace-package-smoke",
        private: true,
        type: "module",
      },
      null,
      2,
    )}\n`,
  )
  run(
    npm,
    [
      "install",
      "--prefix",
      temporaryRoot,
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--package-lock=false",
      rootTarball,
      ...packageTarballs,
      ...installSpecs(manifests),
    ],
    temporaryRoot,
  )

  const specifiers = manifests.flatMap((manifest) =>
    validateInstalledPackage(temporaryRoot, manifest),
  )
  const imports = specifiers
    .map((specifier, index) => `import * as entry${index} from ${JSON.stringify(specifier)}`)
    .join("\n")
  const entries = specifiers.map((_, index) => `entry${index}`).join(", ")

  writeFileSync(
    join(temporaryRoot, "package-smoke.ts"),
    `${imports}\n\nconst entries: readonly object[] = [${entries}]\nvoid entries\n`,
  )
  writeFileSync(
    join(temporaryRoot, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          strict: true,
          target: "ESNext",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          noEmit: true,
          skipLibCheck: true,
          types: ["node"],
        },
        files: ["./package-smoke.ts"],
      },
      null,
      2,
    )}\n`,
  )
  run(
    process.execPath,
    [
      join(repositoryRoot, "node_modules", "typescript", "bin", "tsc"),
      "--project",
      join(temporaryRoot, "tsconfig.json"),
    ],
    temporaryRoot,
  )

  writeFileSync(
    join(temporaryRoot, "package-smoke.mjs"),
    `const specifiers = ${JSON.stringify(specifiers)}\n\nfor (const specifier of specifiers) {\n  const entry = await import(specifier)\n  if (Reflect.ownKeys(entry).length === 0) throw new Error(\`\${specifier} has no runtime exports\`)\n}\n`,
  )
  run(process.execPath, [join(temporaryRoot, "package-smoke.mjs")], temporaryRoot)
  console.log(
    `Validated ${manifests.length} packed workspace packages and ${specifiers.length} runtime entrypoints in Node and TypeScript.`,
  )
} finally {
  rmSync(temporaryRoot, {
    recursive: true,
    force: true,
  })
}
