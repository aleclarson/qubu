import { SQL } from './core.ts'
import { SQLTokenize } from './symbols.ts'
import { Token } from './tokens.ts'

// prettier-ignore
const binaryOperators = {
  "=": 1, "!=": 1, ">": 1, ">=": 1, "<": 1, "<=": 1, "in": 1, "not in": 1,
  "like": 1, "not like": 1, "ilike": 1, "not ilike": 1, "between": 1,
  "not between": 1
} as const

export type BinaryOperator = keyof typeof binaryOperators

/**
 * An expression is a SQL object that evaluates to a value.
 */
export abstract class Expression<Out = any> {
  /**
   * Expressions must implement tokenization. Note that
   * `this[SQLAlias]` is tokenized for you.
   */
  protected abstract [SQLTokenize](tokens: Token[], root?: SQL): void
}
