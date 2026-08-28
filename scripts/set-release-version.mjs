import assert from "node:assert/strict"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { packageRoot, readManifest, workspacePackageDirectories } from "./workspace-packages.mjs"

const check = process.argv.includes("--check")
const versionArgument = process.argv.slice(2).find((argument) => argument !== "--check")
const version = (versionArgument ?? (check ? readManifest(".").version : undefined))?.replace(
  /^v/,
  "",
)

assert(
  version && /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version),
  "Usage: node scripts/set-release-version.mjs [<version>] [--check]",
)

for (const directory of workspacePackageDirectories) {
  const manifestPath = join(packageRoot(directory), "package.json")
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
  const expectedPeer = version

  if (check) {
    assert.equal(manifest.version, version, `${manifest.name} version must be ${version}`)
    if (directory !== ".") {
      assert.equal(
        manifest.peerDependencies?.qubu,
        expectedPeer,
        `${manifest.name} must require qubu ${expectedPeer}`,
      )
    }

    continue
  }

  manifest.version = version
  if (directory !== ".") {
    assert(manifest.peerDependencies?.qubu, `${manifest.name} must declare a qubu peer dependency`)
    manifest.peerDependencies.qubu = expectedPeer
  }

  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`Set ${manifest.name} to ${version}`)
}
