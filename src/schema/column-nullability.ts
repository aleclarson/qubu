declare const declaredColumnNullability: unique symbol

/** @internal */
export type DeclaredColumnNullability<TNullable extends boolean> = {
  readonly [declaredColumnNullability]: TNullable
}

/** @internal */
export type DeclaredColumnNullabilityOf<TColumn> =
  TColumn extends DeclaredColumnNullability<infer TNullable> ? TNullable : never
