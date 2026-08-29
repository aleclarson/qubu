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

const expectedPeer = version
const workspacePackageNames = new Set(
  workspacePackageDirectories.map((directory) => readManifest(directory).name),
)

for (const directory of workspacePackageDirectories) {
  const manifestPath = join(packageRoot(directory), "package.json")
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))

  if (check) {
    assert.equal(manifest.version, version, `${manifest.name} version must be ${version}`)
    if (directory !== ".") {
      for (const peerName of workspacePackageNames) {
        if (peerName === manifest.name || manifest.peerDependencies?.[peerName] === undefined) {
          continue
        }

        assert.equal(
          manifest.peerDependencies[peerName],
          expectedPeer,
          `${manifest.name} must require ${peerName} ${expectedPeer}`,
        )
      }

      assert(manifest.peerDependencies?.qubu, `${manifest.name} must require qubu`)
    }

    continue
  }

  manifest.version = version
  if (directory !== ".") {
    assert(manifest.peerDependencies?.qubu, `${manifest.name} must declare a qubu peer dependency`)
    for (const peerName of workspacePackageNames) {
      if (manifest.peerDependencies[peerName] !== undefined) {
        manifest.peerDependencies[peerName] = expectedPeer
      }
    }
  }

  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`Set ${manifest.name} to ${version}`)
}
