import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { sourceTrace } from "../src/vite.js";
import { reactAliases } from "./react-versions.js";

const classic = process.argv[2] === "classic";
const server = await createServer({
  configFile: false,
  resolve: { alias: reactAliases(process.argv[4] ?? "react18") },
  plugins: [
    sourceTrace({
      enabled: true,
      root: process.cwd(),
    }),
    react({ jsxRuntime: classic ? "classic" : "automatic" }),
  ],
  server: {
    host: "127.0.0.1",
    port: Number(process.argv[3]),
    strictPort: true,
  },
});
await server.listen();
server.printUrls();
