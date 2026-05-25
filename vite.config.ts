import { defineConfig } from "vite"
import vue from "@vitejs/plugin-vue"
import { resolve } from "path"

export default defineConfig({
  plugins: [vue()],
  root: ".",
  base: "./",
  resolve: {
    alias: {
      "@": resolve("src"),
    },
  },
  build: {
    outDir: "dist-renderer",
    emptyOutDir: true,
    target: "esnext",
  },
  server: {
    port: 5173,
    strictPort: false,
    watch: {
      ignored: ["**/src-tauri/target/**"],
    },
  },
})