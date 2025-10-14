## Aliasing an expression

No matter what you're aliasing, the pattern is always the same:

```ts
sql(expression).as(alias)
```

Whether you're aliasing a column, table, or a SQL expression, the pattern is the same.

```ts
// Table example
sql(users).as('u')

// Column example
sql(users.id).as('user_id')
```
