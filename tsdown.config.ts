import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    introspection: 'src/introspection/index.ts',
    postgres: 'src/dialects/postgres.ts',
    sqlite: 'src/dialects/sqlite.ts',
    mysql: 'src/dialects/mysql.ts',
    snapshot: 'src/snapshot/index.ts',
    diff: 'src/diff/index.ts',
    ddl: 'src/ddl/index.ts',
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
      exports['./globals'] = isPublish
        ? './dist/vite/ambient.d.ts'
        : './src/vite/ambient.d.ts'
      return exports
    },
  },
})
