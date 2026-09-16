import react from '@vitejs/plugin-react'
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  base: '/thinkerview-chapitres/',
  plugins: [react()],
  test: {
    environment: 'jsdom',
    exclude: [...configDefaults.exclude, 'tests/e2e/**'],
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
})
