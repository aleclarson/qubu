import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { verifyArtifactChain } from "@qubu/migrate/repository"
import { integer, schema, table } from "qubu"
import { createSchemaSnapshot } from "qubu/snapshot"
import { postgresSchemaDialect } from "qubu/snapshot/postgres"
import { expect, test } from "vitest"

import { cliExitCodes, runCli } from "../src/cli.ts"
import { FileArtifactRepository } from "../src/repository.ts"

test.each([
  {
    secondId: "initial",
    duplicate: true,
  },
  {
    secondId: "next",
    duplicate: false,
  },
])(
  "preserves a valid repository when creating migration $secondId",
  async ({ secondId, duplicate }) => {
    const cwd = await mkdtemp(join(tmpdir(), "qubu-create-identity-audit-"))

    try {
      const records = table("records", { id: integer() })
      const snapshot = createSchemaSnapshot(schema({ records }, { namespace: "public" }), {
        dialect: postgresSchemaDialect,
      })
      const errors: string[] = []
      const runtime = {
        cwd,
        loadConfig: async () => ({
          artifacts: "migrations",
          snapshot,
        }),
        stdout: () => {},
        stderr: (text: string) => errors.push(text),
      }

      expect(
        await runCli(["migrate", "create", "initial", "--format", "json"], runtime),
        errors.join(""),
      ).toBe(cliExitCodes.success)
      const repository = new FileArtifactRepository("migrations", cwd)
      const original = await repository.list()

      expect(original).toHaveLength(1)
      expect((await verifyArtifactChain(repository)).ok).toBe(true)
      const exit = await runCli(["migrate", "create", secondId, "--format", "json"], runtime)
      const persisted = await repository.list()

      if (duplicate) {
        expect.soft(exit).toBe(cliExitCodes.validation)
        // Rejection must leave the previous sealed artifact byte-for-byte intact.
        expect.soft(persisted).toEqual(original)
      } else {
        expect(exit, errors.join("")).toBe(cliExitCodes.success)
        expect(persisted).toHaveLength(2)
        expect(persisted[0]).toBe(original[0])
      }

      const verified = await verifyArtifactChain(repository)

      expect(verified.ok, JSON.stringify(verified)).toBe(true)
    } finally {
      await rm(cwd, {
        recursive: true,
        force: true,
      })
    }
  },
)
