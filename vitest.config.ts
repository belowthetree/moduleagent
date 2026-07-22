import { configDefaults, defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'happy-dom',
    setupFiles: ['./vitest.setup.ts'],
    // 保留 vitest 默认排除（含 **/node_modules/**），追加 e2e 与各工具产物目录
    exclude: [
      ...configDefaults.exclude,
      'e2e/**',
      '.opencode/**',
      '.claude/**',
      '.sisyphus/**',
      '.reasonix/**',
      '.module-agent/**',
    ],
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
