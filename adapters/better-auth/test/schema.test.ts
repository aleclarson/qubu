import { betterAuthSchema, BetterAuthSchemaError } from "@qubu/better-auth"
import type { BetterAuthOptions, BetterAuthPlugin } from "better-auth/types"
import { expect, test } from "vitest"

test("derives custom names, fields, plugin tables, references, and indexes", () => {
  const plugin = {
    id: "teams",
    schema: {
      team: {
        modelName: "auth_teams",
        fields: {
          ownerId: {
            type: "string",
            fieldName: "owner_id",
            references: {
              model: "user",
              field: "id",
              onDelete: "cascade",
            },
          },
          slug: {
            type: "string",
            unique: true,
          },
        },
        indexes: [
          {
            name: "team_owner_slug",
            fields: ["ownerId", "slug"],
          },
        ],
      },
    },
  } satisfies BetterAuthPlugin
  const options = {
    user: {
      modelName: "auth_users",
      fields: { email: "email_address" },
      additionalFields: {
        profile: {
          type: "json",
          required: false,
        },
      },
    },
    plugins: [plugin],
  } satisfies BetterAuthOptions

  const result = betterAuthSchema(options, "postgresql")

  expect(result.tableFor("user").tableName).toBe("auth_users")
  expect(result.tableFor("auth_users")).toBe(result.tableFor("user"))
  expect(result.tableFor("user").sqlNames.email).toBe("email_address")
  expect(result.tableFor("user").sqlNames.emailVerified).toBe("email_verified")
  expect(result.tableFor("user").definitions.profile.nullable).toBe(true)
  expect(result.tableFor("team").tableName).toBe("auth_teams")
  expect(result.tableFor("team").constraints).toHaveProperty("ownerIdReference")
  expect(result.tableFor("team").constraints).toHaveProperty("slugUnique")
  expect(result.tableFor("team").indexes).toHaveProperty("team_owner_slug")
})

test("uses snake_case defaults while preserving explicit camelCase overrides", () => {
  const result = betterAuthSchema(
    {
      user: {
        fields: { emailVerified: "emailVerified" },
        additionalFields: {
          displayName: { type: "string" },
        },
      },
    },
    "postgresql",
  )

  expect(result.tableFor("user").sqlNames).toMatchObject({
    emailVerified: "emailVerified",
    createdAt: "created_at",
    displayName: "display_name",
  })
})

test("rejects fields that collide after snake_case resolution", () => {
  expect(() =>
    betterAuthSchema(
      {
        user: {
          additionalFields: {
            userId: { type: "string" },
            userID: { type: "string" },
          },
        },
      },
      "postgresql",
    ),
  ).toThrowError(
    expect.objectContaining({
      diagnostics: [
        expect.objectContaining({
          code: "duplicate-sql-name",
          path: ["user", "fields", "userID", "fieldName"],
        }),
      ],
    }),
  )
})

test("rejects lossy Better Auth enum fields with a path-addressed diagnostic", () => {
  expect(() =>
    betterAuthSchema(
      {
        user: {
          additionalFields: {
            role: { type: ["member", "admin"] },
          },
        },
      },
      "sqlite",
    ),
  ).toThrowError(BetterAuthSchemaError)

  try {
    betterAuthSchema(
      { user: { additionalFields: { role: { type: ["member", "admin"] } } } },
      "sqlite",
    )
  } catch (error) {
    expect((error as BetterAuthSchemaError).diagnostics[0]).toMatchObject({
      code: "unsupported-field-type",
      path: ["user", "fields", "role", "type"],
    })
  }
})

test("preserves serial identity and bigint number behavior in Qubu metadata", () => {
  const result = betterAuthSchema(
    {
      advanced: { database: { generateId: "serial" } },
      user: {
        additionalFields: {
          sequence: {
            type: "number",
            bigint: true,
          },
        },
      },
    },
    "sqlite",
  )

  expect(result.tableFor("user").definitions.id.identity).toMatchObject({
    kind: "identity",
    dialect: {
      dialect: "sqlite",
      autoIncrement: true,
    },
  })
  expect(result.tableFor("user").definitions.sequence.storage).toEqual({
    kind: "portable",
    type: "bigint",
  })
  expect(
    result.tableFor("user").definitions.sequence.resultDecoder?.(42n, {
      dialect: {} as never,
      field: "sequence",
      rowIndex: 0,
    }),
  ).toBe(42)
})

test("preserves PostgreSQL UUID and timestamp database generation", () => {
  const result = betterAuthSchema(
    {
      advanced: { database: { generateId: "uuid" } },
      user: {
        additionalFields: {
          activatedAt: {
            type: "date",
            defaultValue: () => new Date(),
          },
        },
      },
    },
    "postgresql",
  )

  expect(result.tableFor("user").definitions.id.default).toMatchObject({
    kind: "expression",
  })
  expect(result.tableFor("user").definitions.activatedAt.default).toMatchObject({
    kind: "expression",
  })
})

test("rejects references to unknown fields during schema derivation", () => {
  expect(() =>
    betterAuthSchema(
      {
        user: {
          additionalFields: {
            managerId: {
              type: "string",
              references: {
                model: "user",
                field: "missing",
              },
            },
          },
        },
      },
      "postgresql",
    ),
  ).toThrowError(
    expect.objectContaining({
      diagnostics: [
        expect.objectContaining({
          code: "invalid-reference",
          path: ["user", "fields", "managerId", "references"],
        }),
      ],
    }),
  )
})
