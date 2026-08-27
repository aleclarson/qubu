declare const declaredColumnNullability: unique symbol

/** Compile-time nullability retained by a column from its table declaration. */
export type DeclaredColumnNullability<TNullable extends boolean> = {
  readonly [declaredColumnNullability]: TNullable
}

/** @internal */
export type DeclaredColumnNullabilityOf<TColumn> =
  TColumn extends DeclaredColumnNullability<infer TNullable> ? TNullable : never
