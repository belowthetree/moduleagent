import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'happy-dom',
    setupFiles: ['./vitest.setup.ts'],
    exclude: ['e2e/**', 'node_modules/**'],
  },
  resolve: {
    alias: {
      '@': resolve('src/renderer/src'),
    },
  },
  ssr: {
    noExternal: [/html-encoding-sniffer/, /@exodus\/bytes/],
  },
  optimizeDeps: {
    include: ['html-encoding-sniffer', '@exodus/bytes'],
    esbuildOptions: {
      mainFields: ['module', 'main'],
    },
  },
})
