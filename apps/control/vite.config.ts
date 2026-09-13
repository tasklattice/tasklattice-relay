import { fileURLToPath, URL } from "node:url";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

export default defineConfig({
  ssr: {
    // Candidate evaluation reuses the exact production runtime engines. Bundle
    // the workspace source into Control so pre-publication execution cannot
    // drift from the separately deployed runtime image.
    noExternal: ["@tali/expert-agent-runtime"],
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  plugins: [
    nitro({
      serverDir: "server",
      features: { websocket: true },
    }),
    tailwindcss(),
    tanstackStart(),
    react(),
  ],
});
