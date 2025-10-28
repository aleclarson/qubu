import { $decode, $encode, pgType } from '../type.ts'

/**
 * The JS type for `date` columns is determined by the client adapter.
 */
export interface DateType {
  input: unknown
  output: unknown
}

/**
 * PostgreSQL date type.
 */
export const date = pgType(
  'date',
  $encode<DateType['input']>(),
  $decode<DateType['output']>()
)
