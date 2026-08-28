/** Stable failure categories raised while building a Drizzle schema. */
export type DrizzleSchemaConversionErrorCode =
  | 'missing-storage'
  | 'unsupported-metadata'

/** A path-addressed failure raised when Drizzle cannot represent Qubu metadata. */
export class DrizzleSchemaConversionError extends TypeError {
  readonly name = 'DrizzleSchemaConversionError'
  readonly code: DrizzleSchemaConversionErrorCode
  readonly path: readonly (string | number)[]

  constructor(
    code: DrizzleSchemaConversionErrorCode,
    message: string,
    path: readonly (string | number)[]
  ) {
    super(message)
    this.code = code
    this.path = Object.freeze([...path])
  }
}
