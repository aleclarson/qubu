import { readdirSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")

const workspaceRoots = ["packages", "adapters"]

const discoveredWorkspaceDirectories = workspaceRoots
  .flatMap((workspaceRoot) =>
    readdirSync(join(repositoryRoot, workspaceRoot), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(workspaceRoot, entry.name)),
  )
  .filter((directory) => {
    try {
      readFileSync(join(repositoryRoot, directory, "package.json"))
      return true
    } catch {
      return false
    }
  })

export const workspaceChildDirectories = sortByWorkspaceDependencies(discoveredWorkspaceDirectories)

export const workspacePackageDirectories = [".", ...workspaceChildDirectories]

export function packageRoot(directory) {
  return resolve(repositoryRoot, directory)
}

export function readManifest(directory) {
  return JSON.parse(readFileSync(join(packageRoot(directory), "package.json"), "utf8"))
}

function sortByWorkspaceDependencies(directories) {
  const entries = directories.map((directory) => ({
    directory,
    manifest: readManifest(directory),
  }))
  const remaining = new Map(entries.map((entry) => [entry.manifest.name, entry]))
  const sorted = []

  while (remaining.size) {
    const ready = [...remaining.values()]
      .filter(({ manifest }) =>
        Object.keys({
          ...manifest.dependencies,
          ...manifest.peerDependencies,
          ...manifest.optionalDependencies,
        }).every((name) => !remaining.has(name)),
      )
      .toSorted((left, right) => left.manifest.name.localeCompare(right.manifest.name))

    if (!ready.length) {
      throw new Error("Workspace package dependency cycle")
    }

    for (const entry of ready) {
      remaining.delete(entry.manifest.name)
      sorted.push(entry.directory)
    }
  }

  return sorted
}
