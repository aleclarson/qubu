# Better Auth

> Define auth tables with Qubu and connect Better Auth to a transactional Qubu client.

## Install the integration

Install the integration next to Qubu and Better Auth:

```sh
pnpm add qubu @qubu/better-auth better-auth
```

## Define the auth schema

Define the Better Auth options once. Qubu derives its schema from Better Auth’s
resolved public metadata, including:

- Core tables and renamed models or fields.
- Additional fields and plugin tables.
- References and unique constraints.
- Compound indexes.

```ts
import { betterAuth } from "better-auth"
import type { BetterAuthOptions } from "better-auth/types"
import { twoFactor } from "better-auth/plugins"
import { betterAuthSchema, qubuAdapter } from "@qubu/better-auth"
import { qubu } from "qubu"
import { pgAdapter } from "@qubu/adapter-pg"

const options = {
  user: {
    modelName: "auth_users",
    additionalFields: {
      locale: { type: "string", required: false },
    },
  },
  plugins: [twoFactor()],
} satisfies BetterAuthOptions

const authSchema = betterAuthSchema(options, "postgresql")
const db = qubu(pgAdapter(pool))

export const auth = betterAuth({
  ...options,
  database: qubuAdapter(db, { schema: authSchema }),
})
```

`authSchema` is an ordinary Qubu `Schema`. Hand it to Qubu snapshot, diff,
migration-plan, and DDL workflows. The adapter's Better Auth `createSchema`
hook emits a TypeScript module that reconstructs the same Qubu-owned metadata.

## Database requirements

The package never imports PostgreSQL, MySQL, or SQLite drivers. It executes
through Qubu's query and transaction boundaries. PostgreSQL and SQLite use one
limited mutation statement for atomic consume and guarded increment operations;
MySQL locks one selected row inside the Qubu-owned transaction. A client without
transaction support, or a dialect other than PostgreSQL, MySQL, or SQLite, is
rejected during adapter construction.

## Enum limitation

Better Auth enum metadata is currently rejected because Qubu cannot preserve
the closed value set as a portable column without adding a database constraint.
The error includes the model and field path instead of silently widening it to
text.
