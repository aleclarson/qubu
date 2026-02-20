import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    isolate: false,
    typecheck: {
      enabled: true,
      include: ['test/**/*.test.ts'],
    },
  },
})
