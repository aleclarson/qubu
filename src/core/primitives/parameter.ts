import { fragment, type Fragment } from "../fragment.ts"
import type { SqlTypeName } from "../sql-types.ts"

export function parameter<T>(_value: T, sqlType?: SqlTypeName): Fragment<never> {
  return fragment((context) => context.parameter(_value, sqlType))
}
