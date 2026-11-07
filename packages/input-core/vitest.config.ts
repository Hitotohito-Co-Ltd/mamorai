import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/report/**', 'src/risk/**', 'src/shift/**', 'src/notify/**', 'src/training/**', 'src/template/**', 'src/haito/**', 'src/talent/**', 'src/types.ts'],
      thresholds: { lines: 90, functions: 90, branches: 90, statements: 90 }
    }
  }
})
