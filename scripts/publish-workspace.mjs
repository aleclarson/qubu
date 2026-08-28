import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { packageRoot, readManifest, workspacePackageDirectories } from "./workspace-packages.mjs"

const dryRun = process.argv.includes("--dry-run")
const npm = process.platform === "win32" ? "npm.cmd" : "npm"
const packageManager = process.platform === "win32" ? "pnpm.cmd" : "pnpm"

function run(command, args, directory, stdio = "inherit") {
  return spawnSync(command, args, {
    cwd: packageRoot(directory),
    env: process.env,
    encoding: "utf8",
    stdio,
  })
}

function isAtLeast(version, minimum) {
  const actual = version.split(".").map(Number)

  for (const [index, part] of minimum.entries()) {
    if (actual[index] > part) {
      return true
    }

    if (actual[index] < part) {
      return false
    }
  }

  return true
}

const npmVersion = run(npm, ["--version"], ".", "pipe").stdout?.trim()

assert(
  npmVersion && isAtLeast(npmVersion, [11, 5, 1]),
  `Trusted publishing requires npm 11.5.1 or newer; found ${npmVersion ?? "unknown"}`,
)
assert(
  isAtLeast(process.versions.node, [22, 14, 0]),
  `Trusted publishing requires Node 22.14.0 or newer; found ${process.versions.node}`,
)

function isPublished(name, version) {
  const result = run(npm, ["view", `${name}@${version}`, "version"], ".", "pipe")

  if (result.status === 0) {
    return true
  }

  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`

  if (/\bE404\b|404 Not Found/.test(output)) {
    return false
  }

  throw new Error(`Could not check ${name}@${version}:\n${output.trim()}`)
}

const temporaryRoot = dryRun ? undefined : mkdtempSync(join(tmpdir(), "qubu-publish-"))

try {
  for (const [index, directory] of workspacePackageDirectories.entries()) {
    const { name, version } = readManifest(directory)

    assert.equal(typeof name, "string", `${directory} must have a package name`)
    assert.equal(typeof version, "string", `${directory} must have a package version`)

    if (dryRun) {
      console.log(`Would pack and publish ${name}@${version} from ${directory}`)
      continue
    }

    if (isPublished(name, version)) {
      console.log(`Skipping ${name}@${version}; it is already published.`)
      continue
    }

    const tarball = join(temporaryRoot, `package-${index}.tgz`)
    const packed = run(packageManager, ["pack", "--out", tarball], directory, "pipe")

    if (packed.stdout) {
      process.stdout.write(packed.stdout)
    }

    if (packed.stderr) {
      process.stderr.write(packed.stderr)
    }

    if (packed.status !== 0) {
      throw new Error(`Packing ${name}@${version} failed.`)
    }

    console.log(`Publishing ${name}@${version} from ${directory}`)
    const result = run(
      npm,
      ["publish", tarball, "--provenance", "--access", "public"],
      directory,
      "pipe",
    )

    if (result.stdout) {
      process.stdout.write(result.stdout)
    }

    if (result.stderr) {
      process.stderr.write(result.stderr)
    }

    if (result.status !== 0) {
      const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`

      if (/cannot publish over the previously published versions/i.test(output)) {
        console.log(`Skipping ${name}@${version}; npm confirms it is already published.`)
        continue
      }

      throw new Error(`Publishing ${name}@${version} failed.`)
    }
  }
} finally {
  if (temporaryRoot) {
    rmSync(temporaryRoot, {
      recursive: true,
      force: true,
    })
  }
}
