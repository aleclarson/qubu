// prettier-ignore
export const binaryOperators = {
  "=": 1, "!=": 1, ">": 1, ">=": 1, "<": 1, "<=": 1, "in": 1, "not in": 1,
  "like": 1, "not like": 1, "ilike": 1, "not ilike": 1, "between": 1,
  "not between": 1
} as const

export type BinaryOperator = keyof typeof binaryOperators
