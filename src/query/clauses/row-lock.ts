import {
  assertDialectCapability,
  type RowLockMode,
  type RowLockWaitPolicy,
} from '../../core/dialect.ts'
import type { RequiresCapabilityMeta } from '../../core/fragment.ts'
import { queryValidationError } from '../errors.ts'
import { createClause, type SelectClause } from './types.ts'

export type { RowLockMode, RowLockWaitPolicy }

export interface RowLockOptions<
  TMode extends RowLockMode = RowLockMode,
  TWait extends RowLockWaitPolicy = RowLockWaitPolicy,
> {
  readonly mode?: TMode
  readonly wait?: TWait
  readonly waitPolicy?: TWait
}

export interface RowLockClause<
  TMode extends RowLockMode = RowLockMode,
  TWait extends RowLockWaitPolicy = RowLockWaitPolicy,
> extends SelectClause<RequiresCapabilityMeta<'row-locking'>> {
  readonly clauseKind: 'row-lock'
  readonly mode: TMode
  readonly wait: TWait
}

const rowLockModes = [
  'update',
  'no-key-update',
  'share',
  'key-share',
] as const satisfies readonly RowLockMode[]

const rowLockWaitPolicies = [
  'default',
  'nowait',
  'skip-locked',
] as const satisfies readonly RowLockWaitPolicy[]

export function rowLock(): RowLockClause<'update', 'default'>
export function rowLock<TMode extends RowLockMode>(
  mode: TMode
): RowLockClause<TMode, 'default'>
export function rowLock<
  TMode extends RowLockMode,
  TWait extends RowLockWaitPolicy,
>(mode: TMode, wait: TWait): RowLockClause<TMode, TWait>
export function rowLock(options: RowLockOptions): RowLockClause
export function rowLock(
  modeOrOptions: RowLockMode | RowLockOptions = 'update',
  wait: RowLockWaitPolicy = 'default'
): RowLockClause {
  const mode =
    typeof modeOrOptions === 'string'
      ? modeOrOptions
      : (modeOrOptions.mode ?? 'update')
  const waitPolicy =
    typeof modeOrOptions === 'string'
      ? wait
      : (modeOrOptions.wait ?? modeOrOptions.waitPolicy ?? 'default')

  validateRowLockMode(mode)
  validateRowLockWaitPolicy(waitPolicy)

  return Object.assign(
    createClause('row-lock', 'after-select', 110, context => {
      assertDialectCapability(context.dialect, 'row-locking')
      const policy = context.dialect.rowLocking
      if (!policy) {
        throw new Error(
          `Dialect "${context.dialect.name}" advertises the "row-locking" capability without a row-locking policy`
        )
      }
      policy.render(context, mode, waitPolicy)
    }),
    {
      clauseKind: 'row-lock' as const,
      mode,
      wait: waitPolicy,
    }
  ) as RowLockClause
}

function validateRowLockMode(mode: unknown): asserts mode is RowLockMode {
  if (rowLockModes.includes(mode as RowLockMode)) return

  throw queryValidationError({
    code: 'invalid-row-lock',
    context: 'select.row-lock',
    path: ['rowLock', 'mode'],
    message: `rowLock() does not support the "${String(mode)}" lock mode`,
    hint: 'Use update, no-key-update, share, or key-share.',
  })
}

function validateRowLockWaitPolicy(
  wait: unknown
): asserts wait is RowLockWaitPolicy {
  if (rowLockWaitPolicies.includes(wait as RowLockWaitPolicy)) return

  throw queryValidationError({
    code: 'invalid-row-lock',
    context: 'select.row-lock',
    path: ['rowLock', 'wait'],
    message: `rowLock() does not support the "${String(wait)}" wait policy`,
    hint: 'Use default, nowait, or skip-locked.',
  })
}
