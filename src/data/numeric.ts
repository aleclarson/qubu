import { pgType } from '../core.ts'

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
    (x: number) => x,
    x => x as number
  )
