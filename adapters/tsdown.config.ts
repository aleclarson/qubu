import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  fixedExtension: true,
  dts: true,
  clean: true,
  exports: {
    devExports: true,
    customExports(exports, { isPublish }) {
      if (isPublish) {
        exports['.'] = './dist/index.mjs'
      }
      return exports
    },
  },
})
