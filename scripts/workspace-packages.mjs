import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..'
)

export const adapterDirectories = readdirSync(
  join(repositoryRoot, 'adapters'),
  { withFileTypes: true }
)
  .filter(entry => entry.isDirectory())
  .map(entry => join('adapters', entry.name))
  .filter(directory => {
    try {
      readFileSync(join(repositoryRoot, directory, 'package.json'))
      return true
    } catch {
      return false
    }
  })
  .toSorted()

export const workspacePackageDirectories = ['.', ...adapterDirectories]

export function packageRoot(directory) {
  return resolve(repositoryRoot, directory)
}

export function readManifest(directory) {
  return JSON.parse(
    readFileSync(join(packageRoot(directory), 'package.json'), 'utf8')
  )
}
