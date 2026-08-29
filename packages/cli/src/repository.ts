import { mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { basename, join, resolve } from "node:path"

import { encodeBaselineArtifact, encodeExecutableArtifact } from "@qubu/migrate/artifact"
import type { MigrationArtifact } from "@qubu/migrate/artifact"
import type { ArtifactRepository } from "@qubu/migrate/repository"

export class FileArtifactRepository implements ArtifactRepository {
  readonly directory: string

  constructor(directory: string, cwd = process.cwd()) {
    this.directory = resolve(cwd, directory)
  }

  async list(): Promise<readonly string[]> {
    let names: string[]

    try {
      names = await readdir(this.directory)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return []
      }

      throw error
    }

    const files = names.filter((name) => name.endsWith(".json")).toSorted()

    return Promise.all(files.map((name) => readFile(join(this.directory, name), "utf8")))
  }

  async write(artifact: MigrationArtifact): Promise<string> {
    await mkdir(this.directory, { recursive: true })
    const name = `${String(artifact.sequence).padStart(6, "0")}-${safeName(artifact.id)}.json`
    const path = join(this.directory, name)
    const encoded =
      artifact.format === "qubu-executable-migration"
        ? encodeExecutableArtifact(artifact)
        : encodeBaselineArtifact(artifact)

    await writeFile(path, encoded, {
      encoding: "utf8",
      flag: "wx",
    })
    return path
  }
}

function safeName(value: string): string {
  const name = basename(value).replaceAll(/[^a-zA-Z0-9._-]/gu, "-")

  if (!name || name === "." || name === "..") {
    throw new Error("Invalid artifact ID")
  }

  return name
}
