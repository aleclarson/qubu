/** A portable or dialect-specific SQL value domain. */
export interface SqlSemanticType<TName extends string = string> {
  readonly sqlType: TName
}

/** Marker for extensions whose SQL domain has not been declared. */
export type SqlUnknown = SqlSemanticType<'unknown'> & {
  readonly sqlUnknown: true
}

/** SQL domains accepted by text operations. */
export interface SqlTextLike extends SqlEqualityComparable<'text'> {
  readonly sqlTextLike: true
}

/** SQL domains accepted by numeric operations. */
export interface SqlNumericLike {
  readonly sqlNumericLike: true
}

/** SQL domains with a portable ordering relation. */
export interface SqlOrderable<TGroup = unknown> {
  readonly sqlOrderGroup: TGroup
}

/**
 * SQL domains that can be compared for equality with the same compatibility
 * group. Dialect extensions can share a group with a portable domain.
 */
export interface SqlEqualityComparable<TGroup = unknown> {
  readonly sqlEqualityGroup: TGroup
}

export type SqlText = SqlSemanticType<'text'> &
  SqlTextLike &
  SqlOrderable<'text'> &
  SqlEqualityComparable<'text'>

export type SqlUuid = SqlSemanticType<'uuid'> & SqlEqualityComparable<'uuid'>

export type SqlInteger = SqlSemanticType<'integer'> &
  SqlNumericLike &
  SqlOrderable<'numeric'> &
  SqlEqualityComparable<'numeric'>

export type SqlDecimal = SqlSemanticType<'decimal'> &
  SqlNumericLike &
  SqlOrderable<'numeric'> &
  SqlEqualityComparable<'numeric'>

export type SqlBoolean = SqlSemanticType<'boolean'> &
  SqlEqualityComparable<'boolean'>

export type SqlDate = SqlSemanticType<'date'> &
  SqlOrderable<'date'> &
  SqlEqualityComparable<'date'>

export type SqlTimestamp = SqlSemanticType<'timestamp'> &
  SqlOrderable<'timestamp'> &
  SqlEqualityComparable<'timestamp'>

export type SqlJson<TValue = unknown> = SqlSemanticType<'json'> & {
  readonly sqlJsonValue?: TValue
}

export type SqlBigInt = SqlSemanticType<'bigint'> &
  SqlNumericLike &
  SqlOrderable<'numeric'> &
  SqlEqualityComparable<'numeric'>

export type SqlBinary = SqlSemanticType<'binary'> &
  SqlEqualityComparable<'binary'>

/** Any declared SQL semantic type, including user and dialect extensions. */
export type AnySqlType = SqlSemanticType<string>

type IsUnresolvedSqlType<T> = T extends SqlUnknown
  ? true
  : T extends AnySqlType
    ? string extends T['sqlType']
      ? true
      : false
    : false

/** Whether a declared SQL domain satisfies a semantic capability constraint. */
export type SqlTypeSatisfies<TActual, TConstraint> =
  true extends IsUnresolvedSqlType<TActual>
    ? true
    : TActual extends TConstraint
      ? true
      : false

type EqualityGroup<T> =
  T extends SqlEqualityComparable<infer TGroup> ? TGroup : never

/** Portable equality compatibility, with unknown extension types left open. */
export type SqlEqualityCompatible<TLeft, TRight> =
  true extends IsUnresolvedSqlType<TLeft>
    ? true
    : true extends IsUnresolvedSqlType<TRight>
      ? true
      : [EqualityGroup<TLeft>] extends [never]
        ? false
        : [EqualityGroup<TRight>] extends [never]
          ? false
          : [EqualityGroup<TLeft>] extends [EqualityGroup<TRight>]
            ? [EqualityGroup<TRight>] extends [EqualityGroup<TLeft>]
              ? true
              : false
            : false

type OrderGroup<T> = T extends SqlOrderable<infer TGroup> ? TGroup : never

/** Portable ordering compatibility, with unknown extension types left open. */
export type SqlOrderCompatible<TLeft, TRight> =
  true extends IsUnresolvedSqlType<TLeft>
    ? true
    : true extends IsUnresolvedSqlType<TRight>
      ? true
      : [OrderGroup<TLeft>] extends [never]
        ? false
        : [OrderGroup<TRight>] extends [never]
          ? false
          : [OrderGroup<TLeft>] extends [OrderGroup<TRight>]
            ? [OrderGroup<TRight>] extends [OrderGroup<TLeft>]
              ? true
              : false
            : false
