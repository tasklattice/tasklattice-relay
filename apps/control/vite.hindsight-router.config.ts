import { defineConfig } from "vite";

export default defineConfig({
  build: {
    emptyOutDir: false,
    outDir: ".output/hindsight-router",
    rollupOptions: {
      output: { entryFileNames: "hindsight-router.mjs" },
    },
    ssr: "server/hindsight-router/hindsight-router-server.ts",
    target: "node22",
  },
});
