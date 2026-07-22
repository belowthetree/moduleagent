import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  main: {
    build: {
      outDir: 'out/main',
      rollupOptions: {
        external: [
          'electron',
          'fs-extra',
          'gray-matter',
          'marked',
          'zod',
          'path',
          'url',
          'esbuild',
        ],
        output: {
          format: 'cjs',
        },
      },
    },
    resolve: {
      alias: {
        '@': resolve('src'),
      },
    },
  },
  preload: {
    build: {
      outDir: 'out/preload',
      externalizeDeps: false,
      isolatedEntries: true,
      rollupOptions: {
        external: ['electron'],
        output: {
          format: 'cjs',
        },
      },
    },
  },
  renderer: {
    build: {
      outDir: 'out/renderer',
    },
    plugins: [vue()],
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
      },
    },
    server: {
      port: 5173,
    },
  },
})
