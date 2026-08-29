import { readdirSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")

const workspaceRoots = ["packages", "adapters"]

export const workspaceChildDirectories = workspaceRoots
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

export const workspacePackageDirectories = [".", ...workspaceChildDirectories]

export function packageRoot(directory) {
  return resolve(repositoryRoot, directory)
}

export function readManifest(directory) {
  return JSON.parse(readFileSync(join(packageRoot(directory), "package.json"), "utf8"))
}
