# Valtio Sync

> Check Valtio Sync fields against Qubu tables and apply each client mutation
> with its sync event in one Qubu-owned transaction.

Install the optional integration beside Qubu, Valtio Sync, and Zod:

```sh
pnpm add qubu @qubu/valtio-sync valtio-sync zod
```

## Check synced fields against Qubu tables

Use the integration's schema wrappers instead of `valtio-sync/schema` when a
definition corresponds to a Qubu table. Every selected table field must appear
in `fields`. Mark persistence-only or server-controlled fields with
`serverOnly()` so they are excluded from Valtio Sync validation and records.

```ts
import { $type, defineCollection, serverOnly } from "@qubu/valtio-sync"
import { boolean, integer, table, text } from "qubu"
import { z } from "zod"

const todosTable = table("todos", {
  ownerId: integer(),
  id: text(),
  title: text(),
  done: boolean(),
})

export const todos = defineCollection({
  dbType: $type<typeof todosTable>(),
  fields: {
    ownerId: serverOnly(),
    id: z.string(),
    title: z.string().default(""),
    done: z.boolean().default(false),
  },
})
```

The Zod output for each synced field must be assignable to its Qubu selected
value. Narrow schemas are allowed, such as a Zod enum for a Qubu text field.
Missing fields, extra fields, and wider outputs fail type checking. The same
rules apply to `defineAccount()`.

## Apply mutations in transactions

`applyOpsWithQubu()` converts Qubu-aware mutation handlers into the public
`ServerHandlers` contract accepted by `valtio-sync/server`. Supply a bound Qubu
client whose adapter supports transactions:

```ts
import { applyOpsWithQubu } from "@qubu/valtio-sync"
import { and, eq, insertInto, returning, update, values, where } from "qubu"
import { valtioSync } from "valtio-sync/server"

type SyncContext = { user: { id: number } }

const handlers = applyOpsWithQubu<SyncContext>({
  db,
  syncEvents: {
    write: async ({ tx, ctx, collection, recordId, op }) => {
      const [event] = await tx.rows(
        insertInto(
          syncEvents,
          values({ userId: ctx.user.id, collection, recordId, op }),
          returning({ seq: syncEvents.seq }),
        ),
      )
      return event.seq
    },
  },
  authorize: ({ ctx, collection, op }) => assertCanSync(ctx.user, collection, op),
  checkConflict: ({ tx, ctx, collection, op }) =>
    assertFreshBaseVersion(tx, ctx.user.id, collection, op),
  handlers: {
    todos: {
      readChanges: ({ ctx, since }) => readTodoChanges(ctx.user.id, since),
      create: async ({ tx, ctx, record }) => {
        const value = todos.recordSchema.parse(record)

        await tx.execute(insertInto(todosTable, values({ ...value, ownerId: ctx.user.id })))
        return {}
      },
      update: async ({ tx, ctx, op, patch }) => {
        const value = todos.recordSchema.partial().parse(patch)

        await tx.execute(
          update(
            todosTable,
            value,
            where(and(eq(todosTable.id, op.id), eq(todosTable.ownerId, ctx.user.id))),
          ),
        )
        return {}
      },
    },
  },
})

export const sync = valtioSync({ schema: { todos }, handlers })
```

Authorization, conflict checks, the application mutation, and
`syncEvents.write()` run in that order inside one Qubu transaction. If any step
fails, the adapter rolls the transaction back. The event sequence becomes
`serverVersion` unless the mutation handler returns an explicit version. Read
handlers pass through unchanged.

The integration does not define persistence tables, import Drizzle, or execute
driver APIs. The application owns table design, authorization, conflict policy,
event retention, and every query issued through the supplied Qubu transaction.
