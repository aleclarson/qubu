import type {
  ExplainableQueryAdapter,
  ExplainRequest,
  ExecutionRequest,
  NestedTransactionalQueryAdapter,
  TransactionOptions,
} from "qubu"

/** Internal adapter machinery; SQL and connection ownership remain with the caller. */
export function runSavepointScope<TBase extends ExplainableQueryAdapter, T>(
  base: TBase,
  control: (sql: string) => void | Promise<unknown>,
  callback: (adapter: TBase & NestedTransactionalQueryAdapter<TBase>) => Promise<T>,
): Promise<T> {
  let nextId = 0
  const poison: unknown[] = []

  async function run<TResult>(
    callback: (adapter: TBase & NestedTransactionalQueryAdapter<TBase>) => Promise<TResult>,
  ): Promise<TResult> {
    let open = true
    let child: Promise<unknown> | undefined
    const pending = new Set<Promise<unknown>>()

    function assertAvailable() {
      if (!open) {
        throw new Error("Transaction scope has finished")
      }

      if (poison.length) {
        throw new AggregateError(poison, "Transaction is unsafe after savepoint failure")
      }

      if (child) {
        throw new Error("Transaction scope has an active child")
      }
    }

    function operation<TResult>(execute: () => Promise<TResult>): Promise<TResult> {
      try {
        assertAvailable()
      } catch (error) {
        return Promise.reject(error)
      }

      // Reserve before calling driver code (including custom encoders).
      const promise = Promise.resolve().then(execute)

      pending.add(promise)
      void promise.then(
        () => pending.delete(promise),
        () => pending.delete(promise),
      )
      return promise
    }

    const adapter = {
      ...base,
      execute: (request: ExecutionRequest) => operation(() => base.execute(request)),
      explain: (request: ExplainRequest) => operation(() => base.explain(request)),
      transaction<TResult>(
        callback: (adapter: TBase & NestedTransactionalQueryAdapter<TBase>) => Promise<TResult>,
        options: TransactionOptions = {},
      ): Promise<TResult> {
        try {
          assertAvailable()
          if (pending.size) {
            throw new Error("Transaction scope has pending operations")
          }

          options.signal?.throwIfAborted()
        } catch (error) {
          return Promise.reject(error)
        }

        const name = `qubu_sp_${++nextId}`
        // Reserve synchronously, before SAVEPOINT or user callbacks can run.
        const promise = Promise.resolve().then(async () => {
          try {
            await control(`SAVEPOINT ${name}`)
          } catch (error) {
            poison.push(error)
            throw error
          }

          try {
            options.signal?.throwIfAborted()
            const result = await run(callback)

            options.signal?.throwIfAborted()
            await control(`RELEASE SAVEPOINT ${name}`)
            return result
          } catch (error) {
            try {
              // Recovery deliberately ignores an aborted request signal.
              await control(`ROLLBACK TO SAVEPOINT ${name}`)
              await control(`RELEASE SAVEPOINT ${name}`)
            } catch (cleanupError) {
              const failure = new AggregateError(
                [error, cleanupError],
                "Nested transaction failed and savepoint recovery failed",
                { cause: error },
              )

              poison.push(failure)
              throw failure
            }

            throw error
          }
        })

        child = promise
        void promise.then(
          () => {
            child = undefined
          },
          () => {
            child = undefined
          },
        )
        return promise
      },
    } as TBase & NestedTransactionalQueryAdapter<TBase>

    let result!: TResult
    const failures: unknown[] = []

    try {
      result = await callback(adapter)
    } catch (error) {
      failures.push(error)
    }

    open = false
    // Never release a savepoint/connection while abandoned work can still use it.
    const outstanding = [...pending, ...(child ? [child] : [])]

    if (outstanding.length) {
      failures.push(
        new Error("Transaction callback finished with pending operations or child scopes"),
      )
      for (const outcome of await Promise.allSettled(outstanding)) {
        if (outcome.status === "rejected") {
          failures.push(outcome.reason)
        }
      }
    }

    for (const failure of poison) {
      if (!failures.includes(failure)) {
        failures.push(failure)
      }
    }

    if (failures.length === 1) {
      throw failures[0]
    }

    if (failures.length) {
      throw new AggregateError(failures, "Transaction scope failed", { cause: failures[0] })
    }

    return result
  }

  return run(callback)
}

/** Exclude root operations on a single connection while a callback owns it. */
export function guardTransactionConnection<TBase extends ExplainableQueryAdapter>(base: TBase) {
  let owned = false
  let pending = 0

  async function operation<T>(execute: () => Promise<T>): Promise<T> {
    if (owned) {
      throw new Error("Connection has an active transaction; use its scoped client")
    }

    pending++
    try {
      return await execute()
    } finally {
      pending--
    }
  }

  return {
    adapter: {
      ...base,
      execute: (request: ExecutionRequest) => operation(() => base.execute(request)),
      explain: (request: ExplainRequest) => operation(() => base.explain(request)),
    } as TBase,
    acquire() {
      if (owned || pending) {
        throw new Error("Connection has an active transaction or pending operations")
      }

      owned = true
      return () => {
        owned = false
      }
    },
  }
}
