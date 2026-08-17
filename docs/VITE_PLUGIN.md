# Qubu Vite compiler hint

The optional Vite plugin lets a module opt into Qubu's ambient API with a directive:

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

At build time, the plugin turns the referenced globals into ordinary named imports. Conceptually, the module above receives:

```ts
import { eq, from, integer, select, table, text, where } from 'qubu'
```

Only names actually referenced by the module are injected. Existing bindings and member properties are left alone.

## Setup

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { qubu } from 'qubu/vite'

export default defineConfig({
  plugins: [qubu()],
})
```

The Vite transform supplies runtime imports. TypeScript needs the matching opt-in ambient declarations:

```json
{
  "compilerOptions": {
    "types": ["qubu/globals"]
  }
}
```

Merge `qubu/globals` into an existing `types` list rather than replacing project-specific entries.

## Options

```ts
qubu({
  module: 'qubu',
  include: id => id.includes('/src/'),
  exclude: /\.stories\./,
  globals: ['select', 'from', 'where', 'eq', 'table'],
})
```

- `module` changes the import source.
- `include` and `exclude` filter module IDs.
- `globals` narrows the public names eligible for injection.

The hint must be in the module's initial directive prologue. The first implementation handles JavaScript and TypeScript script modules and deliberately skips dependencies under `node_modules`.

Explicit imports remain valid. The plugin is an ergonomic layer, not a replacement for normal ES module semantics.
