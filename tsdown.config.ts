import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    core: 'src/core/index.ts',
    schema: 'src/schema/index.ts',
    introspection: 'src/introspection/index.ts',
    postgres: 'src/dialects/postgres.ts',
    sqlite: 'src/dialects/sqlite.ts',
    mysql: 'src/dialects/mysql.ts',
    snapshot: 'src/snapshot/index.ts',
    diff: 'src/diff/index.ts',
    ddl: 'src/ddl/index.ts',
    drizzle: 'src/drizzle/index.ts',
    'drizzle-mysql': 'src/drizzle/mysql.ts',
    'drizzle-postgres': 'src/drizzle/postgres.ts',
    'drizzle-sqlite': 'src/drizzle/sqlite.ts',
    migration: 'src/migration/index.ts',
    vite: 'src/vite/index.ts',
  },
  format: 'esm',
  fixedExtension: true,
  dts: true,
  clean: true,
  copy: {
    from: 'src/vite/ambient.d.ts',
    to: 'dist/vite',
  },
  exports: {
    devExports: true,
    customExports(exports, { isPublish }) {
      for (const dialect of ['mysql', 'postgres', 'sqlite']) {
        const flatPath = `./drizzle-${dialect}`
        exports[`./drizzle/${dialect}`] = exports[flatPath]
        delete exports[flatPath]
      }

      if (isPublish) {
        for (const [subpath, target] of Object.entries(exports)) {
          if (typeof target !== 'string' || !target.endsWith('.mjs')) continue
          exports[subpath] = {
            types: target.replace(/\.mjs$/, '.d.mts'),
            import: target,
          }
        }
      }

      exports['./globals'] = {
        types: isPublish
          ? './dist/vite/ambient.d.ts'
          : './src/vite/ambient.d.ts',
      }
      return exports
    },
  },
})
