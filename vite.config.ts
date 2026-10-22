import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { sourceTrace } from "./src/vite.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const classic = process.env.SOURCETRACE_JSX === "classic";

export default defineConfig({
  plugins: [
    sourceTrace({
      enabled: process.env.SOURCETRACE_BUILD === "1",
      root,
    }),
    react({ jsxRuntime: classic ? "classic" : "automatic" }),
  ],
  build: {
    outDir: "demo-dist",
    sourcemap: true,
  },
});
