import {
  $type,
  applyOpsWithQubu,
  defineAccount,
  defineCollection,
  serverOnly,
} from "@qubu/valtio-sync"
import {
  boolean,
  integer,
  qubu,
  table,
  text,
  type QueryAdapter,
  type QubuTransaction,
  type TransactionalQueryAdapter,
} from "qubu"
import type { infer as InferSync } from "valtio-sync/schema"
import { z } from "zod"

const accountTable = table("accounts", {
  ownerId: integer(),
  theme: text(),
})
const todosTable = table("todos", {
  ownerId: integer(),
  id: text(),
  title: text(),
  done: boolean(),
})

const account = defineAccount({
  dbType: $type<typeof accountTable>(),
  fields: {
    ownerId: serverOnly(),
    theme: z.enum(["light", "dark"]),
  },
})
const todos = defineCollection({
  dbType: $type<typeof todosTable>(),
  fields: {
    ownerId: serverOnly(),
    id: z.string(),
    title: z.string(),
    done: z.boolean(),
  },
})

const todo: InferSync<typeof todos> = {
  id: "todo-1",
  title: "Draft",
  done: false,
}
const theme: InferSync<typeof account>["theme"] = "dark"

void [todo, theme]

defineCollection({
  dbType: $type<typeof todosTable>(),
  // @ts-expect-error Every selected Qubu field must be classified.
  fields: {
    id: z.string(),
    title: z.string(),
    done: z.boolean(),
  },
})

defineCollection({
  dbType: $type<typeof todosTable>(),
  fields: {
    ownerId: serverOnly(),
    id: z.string(),
    title: z.string(),
    // @ts-expect-error A nullable schema is wider than the non-null Qubu field.
    done: z.boolean().nullable(),
  },
})

declare const adapter: QueryAdapter
const nonTransactionalDb = qubu(adapter)

applyOpsWithQubu({
  // @ts-expect-error Mutation orchestration requires a transactional Qubu client.
  db: nonTransactionalDb,
  syncEvents: { write: () => 1 },
  handlers: {},
})

declare const transactionalAdapter: TransactionalQueryAdapter
const transactionalDb = qubu(transactionalAdapter)

applyOpsWithQubu({
  db: transactionalDb,
  syncEvents: { write: ({ tx }) => (tx.adapter ? 1 : 0) },
  handlers: {
    todos: {
      create: ({ tx }) => {
        const transaction: QubuTransaction = tx

        void transaction
        return {}
      },
    },
  },
})
