- **Standalone functions** are the default API for SQL syntax. In
  other words, avoid method chaining except for the following cases:
  - If some syntax doesn't make sense on its own, and there are
    multiple possible options, add a method for each option. For
    example, in the case of `ON CONFLICT` in an `INSERT` statement,
    it's always followed by either `doNothing()` or `doUpdateSet()`,
    so it makes sense to make them methods of `onConflict()`'s return
    type.
    ```ts
    onConflict(…).doNothing()
    ```
  - In some cases, type safety cannot be achieved unless methods are
    used. For example, the `VALUES` clause of an `INSERT` statement
    cannot be type-safe if the table schema is not known.
    ```ts
    insert(into(…).values(…))
    ```