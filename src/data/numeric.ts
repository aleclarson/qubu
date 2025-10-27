import { $decode, $encode, pgType } from '../type.ts'

/**
 * PostgreSQL numeric type.
 */
export const numeric = (precision?: number, scale?: number) =>
  pgType(
    `numeric${
      precision !== undefined
        ? `(${precision}${scale !== undefined ? `,${scale}` : ''})`
        : ''
    }`,
    $encode<number>(),
    $decode<number>()
  )
