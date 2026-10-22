import { betterAuthSchema } from "@qubu/better-auth"
import type { BetterAuthOptions } from "better-auth/types"
import { expect, test, vi } from "vitest"

test.each(["postgresql", "mysql", "sqlite"] as const)(
  "keeps application-defined date defaults external on %s",
  (dialect) => {
    const defaultValue = vi.fn(() => new Date("2000-01-01T00:00:00.000Z"))
    const options = {
      user: {
        additionalFields: {
          importedAt: {
            type: "date",
            defaultValue,
          },
        },
      },
    } satisfies BetterAuthOptions
    const derived = betterAuthSchema(options, dialect)

    // Arbitrary application callbacks cannot be replaced with the database
    // clock or evaluated while deriving metadata. Better Auth owns execution.
    expect(defaultValue).not.toHaveBeenCalled()
    expect(derived.tableFor("user").definitions.importedAt.default).toEqual({ kind: "external" })
  },
)
