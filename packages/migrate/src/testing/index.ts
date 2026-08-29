export * from "../journal/memory.ts"

import type { ProgramCondition, Sha256Digest, TaggedParameterValue } from "../artifact/index.ts"
import type {
  AdapterFailureClassification,
  MigrationAdapter,
  MigrationAdapterCapabilities,
  MigrationAwaitBoundary,
  MigrationSession,
} from "../executor/types.ts"
import type { MigrationJournal } from "../journal/index.ts"
import { InMemoryMigrationJournal } from "../journal/memory.ts"

export interface FakeMigrationAdapterOptions {
  readonly journal?: InMemoryMigrationJournal
  readonly snapshotDigest: Sha256Digest
  readonly capabilities?: Partial<MigrationAdapterCapabilities>
  readonly conditions?: Readonly<Record<string, boolean>>
  readonly classifyFailure?: AdapterFailureClassification
}

export interface FakeExecution {
  readonly sql: string
  readonly parameters: readonly TaggedParameterValue[]
  readonly transaction: boolean
}

export class DeterministicFakeMigrationAdapter implements MigrationAdapter {
  readonly journal: InMemoryMigrationJournal
  readonly executions: FakeExecution[] = []
  readonly events: string[] = []
  snapshotDigest: Sha256Digest
  #lease = Promise.resolve()
  readonly #options: FakeMigrationAdapterOptions

  constructor(options: FakeMigrationAdapterOptions) {
    this.#options = options
    this.journal = options.journal ?? new InMemoryMigrationJournal()
    this.snapshotDigest = options.snapshotDigest
  }

  async openMigrationSession(): Promise<MigrationSession> {
    this.events.push("open-session")
    let transaction = false
    let staged: FakeExecution[] = []
    let releaseLease: (() => void) | undefined
    const adapter = this
    const capabilities: MigrationAdapterCapabilities = {
      dialect: "sqlite",
      transactionalDdl: true,
      optionalTransactions: true,
      transactions: ["required", "optional", "forbidden"],
      lease: true,
      locks: ["none", "shared", "exclusive"],
      ...this.#options.capabilities,
    }
    const buffered = new BufferedJournal(this.journal, () => transaction)
    return {
      capabilities,
      journal: buffered,
      async acquireLease() {
        adapter.events.push("acquire-lease")
        const prior = adapter.#lease
        adapter.#lease = new Promise<void>((resolve) => {
          releaseLease = resolve
        })
        await prior
      },
      async releaseLease() {
        adapter.events.push("release-lease")
        releaseLease?.()
        releaseLease = undefined
      },
      async acquireDdlLock(lock) {
        adapter.events.push(`acquire-lock:${lock}`)
      },
      async releaseDdlLock(lock) {
        adapter.events.push(`release-lock:${lock}`)
      },
      async beginTransaction() {
        if (transaction) throw new Error("Transaction already active")
        adapter.events.push("begin")
        transaction = true
        buffered.begin()
      },
      async commitTransaction() {
        if (!transaction) throw new Error("No transaction")
        adapter.events.push("commit")
        await buffered.commit()
        adapter.executions.push(...staged)
        staged = []
        transaction = false
      },
      async rollbackTransaction() {
        adapter.events.push("rollback")
        staged = []
        buffered.rollback()
        transaction = false
      },
      async execute(sql, parameters) {
        adapter.events.push("execute")
        const execution = Object.freeze({
          sql,
          parameters: Object.freeze([...parameters]),
          transaction,
        })
        if (transaction) staged.push(execution)
        else adapter.executions.push(execution)
      },
      async checkCondition(condition: ProgramCondition) {
        adapter.events.push(`condition:${condition.id}`)
        return adapter.#options.conditions?.[condition.id] ?? true
      },
      async currentSnapshotDigest() {
        adapter.events.push("snapshot")
        return adapter.snapshotDigest
      },
      async close() {
        adapter.events.push("close-session")
      },
      classifyFailure() {
        return adapter.#options.classifyFailure ?? "definite-failure"
      },
    }
  }
}

/** Produces a deterministic single fault for executor await-boundary tests. */
export function failAtBoundary(target: MigrationAwaitBoundary, occurrence = 1) {
  let seen = 0
  return async (boundary: MigrationAwaitBoundary): Promise<void> => {
    if (boundary === target && ++seen === occurrence)
      throw new Error(`Injected failure at ${target}`)
  }
}

type Mutation = () => Promise<unknown>

class BufferedJournal implements MigrationJournal {
  #queue: Mutation[] = []
  constructor(
    readonly target: MigrationJournal,
    readonly active: () => boolean,
  ) {}
  begin() {
    this.#queue = []
  }
  async commit() {
    for (const mutation of this.#queue) await mutation()
    this.#queue = []
  }
  rollback() {
    this.#queue = []
  }
  readMetadata() {
    return this.target.readMetadata()
  }
  listApplied() {
    return this.target.listApplied()
  }
  listAttempts() {
    return this.target.listAttempts()
  }
  listCheckpoints(id: string) {
    return this.target.listCheckpoints(id)
  }
  listReconciliations() {
    return this.target.listReconciliations()
  }
  async createAttempt(value: Parameters<MigrationJournal["createAttempt"]>[0]) {
    return this.write(() => this.target.createAttempt(value))
  }
  async transitionAttempt(...args: Parameters<MigrationJournal["transitionAttempt"]>) {
    if (this.active() && (args[1] === "recovery_required" || args[1] === "rolled_back")) {
      await this.target.transitionAttempt(...args)
      return
    }
    return this.write(() => this.target.transitionAttempt(...args))
  }
  async checkpoint(value: Parameters<MigrationJournal["checkpoint"]>[0]) {
    return this.write(() => this.target.checkpoint(value))
  }
  async appendApplied(value: Parameters<MigrationJournal["appendApplied"]>[0]) {
    return this.write(() => this.target.appendApplied(value))
  }
  async compareAndSwapHead(...args: Parameters<MigrationJournal["compareAndSwapHead"]>) {
    if (!this.active()) return this.target.compareAndSwapHead(...args)
    const metadata = await this.target.readMetadata()
    if (metadata.head !== args[0]) return false
    this.#queue.push(() => this.target.compareAndSwapHead(...args))
    return true
  }
  async appendAppliedAndAdvanceHead(
    ...args: Parameters<MigrationJournal["appendAppliedAndAdvanceHead"]>
  ) {
    if (!this.active()) return this.target.appendAppliedAndAdvanceHead(...args)
    const metadata = await this.target.readMetadata()
    if (metadata.head !== args[1]) return false
    this.#queue.push(() => this.target.appendAppliedAndAdvanceHead(...args))
    return true
  }
  async recordReconciliation(value: Parameters<MigrationJournal["recordReconciliation"]>[0]) {
    return this.write(() => this.target.recordReconciliation(value))
  }
  private async write(action: Mutation): Promise<void> {
    if (this.active()) this.#queue.push(action)
    else await action()
  }
}

export function fakeDigest(character: string): Sha256Digest {
  return `sha256:${character.repeat(64)}` as Sha256Digest
}
