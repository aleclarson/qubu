# Vite compiler hint

> Opt a JavaScript or TypeScript module into Qubu's ambient query API while keeping the transform limited to explicit directive-bearing files.

The optional Vite plugin recognizes the `"use qubu"` directive and injects only
the referenced named imports from the configured module.

## Install the plugin

Add the plugin to Vite and add the matching ambient declarations to TypeScript:

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { qubu } from 'qubu/vite'

export default defineConfig({
  plugins: [qubu()],
})
```

```jsonc
{
  "compilerOptions": {
    // Merge this with any existing project-specific entries.
    "types": ["qubu/globals"],
  },
}
```

The plugin supplies runtime imports. `qubu/globals` supplies the corresponding
ambient value and type declarations for the TypeScript compiler.

## Mark a module explicitly

Put the directive in the module's initial directive prologue:

```ts
'use qubu'

const users = table('users', {
  id: integer(),
  name: text(),
})

const query = select(
  { id: users.id, name: users.name },
  from(users),
  where(eq(users.id, 42))
)
```

Conceptually, the transform adds the imports that this module references:

```ts
import { eq, from, integer, select, table, text, where } from 'qubu'
```

Existing imports remain valid. The transform does not rewrite member properties,
strings, comments, or names outside the public Qubu global catalog.

## Configure the transform

```ts
qubu({
  module: 'qubu',
  include: id => id.includes('/src/'),
  exclude: /\.stories\./,
  globals: ['select', 'from', 'where', 'eq', 'table'],
})
```

| Option    | Effect                                  | Default               |
| --------- | --------------------------------------- | --------------------- |
| `module`  | Import source for injected names        | `'qubu'`              |
| `include` | Restrict matching module IDs            | no filter             |
| `exclude` | Skip matching module IDs                | no filter             |
| `globals` | Narrow the names eligible for injection | Qubu's public catalog |

## Know the boundaries

- Only JavaScript and TypeScript script extensions are considered.
- Files under `node_modules` are skipped.
- `include` and `exclude` filters run against the module ID.
- A module without the directive is unchanged.
- A module that references no eligible Qubu global is unchanged.
- Normal ES module imports remain the explicit fallback when the hint is not a
  good fit.

The plugin has no runtime dependency on Vite; it returns the small transform
shape Vite expects. Use the package root directly when you want ordinary import
semantics everywhere.
