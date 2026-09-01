import type { QubuTransaction, QubuTransactionalClient } from "qubu"
import type {
  AccountServerHandlers,
  CollectionServerHandlers,
  CreateSyncOp,
  DeleteSyncOp,
  JsonRecord,
  ServerHandlerContext,
  ServerHandlers,
  ServerMutationResult,
  SyncOp,
  UpdateSyncOp,
} from "valtio-sync/server"

/** Input passed before a sync event sequence has been assigned. */
export type QubuSyncEventWriteInput<TContext> = {
  tx: QubuTransaction
  ctx: TContext
  collection: string
  recordId: string
  op: SyncOp["type"]
}

/** Configuration for writing sync events inside the active Qubu transaction. */
export type QubuSyncEventConfig<TContext> = {
  write(input: QubuSyncEventWriteInput<TContext>): number | Promise<number>
}

/** Shared mutation input passed to Qubu-backed handlers. */
export type QubuMutationInput<TContext, TOp extends SyncOp> = ServerHandlerContext<TContext> & {
  tx: QubuTransaction
  op: TOp
}

/** Input passed to Qubu-backed create handlers. */
export type QubuCreateInput<TContext> = QubuMutationInput<TContext, CreateSyncOp> & {
  record: JsonRecord
}

/** Input passed to Qubu-backed update handlers. */
export type QubuUpdateInput<TContext> = QubuMutationInput<TContext, UpdateSyncOp> & {
  patch: JsonRecord
}

/** Input passed to Qubu-backed delete handlers. */
export type QubuDeleteInput<TContext> = QubuMutationInput<TContext, DeleteSyncOp>

/** Mutation result for Qubu handlers; serverVersion defaults to the written event sequence. */
export type QubuMutationResult = Omit<ServerMutationResult, "serverVersion"> & {
  serverVersion?: number
}

/** Account handlers that receive a Qubu transaction for mutations. */
export type QubuAccountHandlers<TContext> = Omit<AccountServerHandlers<TContext>, "update"> & {
  update?: (input: QubuUpdateInput<TContext>) => QubuMutationResult | Promise<QubuMutationResult>
}

/** Collection handlers that receive a Qubu transaction for mutations. */
export type QubuCollectionHandlers<TContext> = Omit<
  CollectionServerHandlers<TContext>,
  "create" | "update" | "delete"
> & {
  create?: (input: QubuCreateInput<TContext>) => QubuMutationResult | Promise<QubuMutationResult>
  update?: (input: QubuUpdateInput<TContext>) => QubuMutationResult | Promise<QubuMutationResult>
  delete?: (input: QubuDeleteInput<TContext>) => QubuMutationResult | Promise<QubuMutationResult>
}

/** Input passed to the optional authorization hook inside the mutation transaction. */
export type QubuSyncAuthorizeInput<TContext> = {
  ctx: TContext
  collection: string
  op: SyncOp
}

/** Input passed to the optional conflict hook inside the mutation transaction. */
export type QubuSyncConflictInput<TContext> = QubuSyncAuthorizeInput<TContext> & {
  tx: QubuTransaction
}

/** Options for converting Qubu-backed handlers into Valtio Sync server handlers. */
export type ApplyOpsWithQubuOptions<TContext> = {
  db: QubuTransactionalClient
  syncEvents: QubuSyncEventConfig<TContext>
  handlers: Record<string, QubuAccountHandlers<TContext> | QubuCollectionHandlers<TContext>>
  authorize?: (input: QubuSyncAuthorizeInput<TContext>) => void | Promise<void>
  checkConflict?: (input: QubuSyncConflictInput<TContext>) => void | Promise<void>
}

/** Wrap Qubu-backed mutations and their sync event write in one required transaction. */
export function applyOpsWithQubu<TContext>(
  options: ApplyOpsWithQubuOptions<TContext>,
): ServerHandlers<TContext> {
  return Object.fromEntries(
    Object.entries(options.handlers).map(([collection, handlers]) => [
      collection,
      wrapHandlers(collection, handlers, options),
    ]),
  )
}

function wrapHandlers<TContext>(
  collection: string,
  handlers: QubuAccountHandlers<TContext> | QubuCollectionHandlers<TContext>,
  options: ApplyOpsWithQubuOptions<TContext>,
): AccountServerHandlers<TContext> | CollectionServerHandlers<TContext> {
  const collectionHandlers = handlers as QubuCollectionHandlers<TContext>
  const create = collectionHandlers.create
  const update = handlers.update
  const deleteHandler = collectionHandlers.delete

  return {
    ...(handlers.readChanges && { readChanges: handlers.readChanges }),
    ...(handlers.readSnapshot && { readSnapshot: handlers.readSnapshot }),
    ...(create && {
      create: (
        input: ServerHandlerContext<TContext> & {
          op: CreateSyncOp
          record: JsonRecord
        },
      ) => applyMutation(options, collection, input, create),
    }),
    ...(update && {
      update: (
        input: ServerHandlerContext<TContext> & {
          op: UpdateSyncOp
          patch: JsonRecord
        },
      ) => applyMutation(options, collection, input, update),
    }),
    ...(deleteHandler && {
      delete: (input: ServerHandlerContext<TContext> & { op: DeleteSyncOp }) =>
        applyMutation(options, collection, input, deleteHandler),
    }),
  }
}

async function applyMutation<
  TContext,
  TInput extends ServerHandlerContext<TContext> & { op: SyncOp },
>(
  options: ApplyOpsWithQubuOptions<TContext>,
  collection: string,
  input: TInput,
  handler: (
    input: TInput & { tx: QubuTransaction },
  ) => QubuMutationResult | Promise<QubuMutationResult>,
): Promise<ServerMutationResult> {
  return options.db.transaction(async (tx) => {
    await options.authorize?.({
      ctx: input.ctx,
      collection,
      op: input.op,
    })
    await options.checkConflict?.({
      tx,
      ctx: input.ctx,
      collection,
      op: input.op,
    })
    const result = await handler({
      ...input,
      tx,
    })
    const eventVersion = await options.syncEvents.write({
      tx,
      ctx: input.ctx,
      collection,
      recordId: input.op.id,
      op: input.op.type,
    })

    return {
      ...result,
      serverVersion: result.serverVersion ?? eventVersion,
    }
  })
}
