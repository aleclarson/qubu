// prettier-ignore
export const BooleanOps = {
  "=": 1, "!=": 1, ">": 1, ">=": 1, "<": 1, "<=": 1, "in": 1, "not in": 1,
  "like": 1, "not like": 1, "ilike": 1, "not ilike": 1, "between": 1,
  "not between": 1, "null": 2, "not null": 2,
} as const

type DefaultBooleanOps = Record<keyof typeof BooleanOps, number>

export interface BooleanOps extends DefaultBooleanOps {}
