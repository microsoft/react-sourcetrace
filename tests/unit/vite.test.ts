import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import react from "@vitejs/plugin-react";
import { build, type Plugin, type Rollup } from "vite";
import { sourceTrace } from "../../src/vite.js";

const root = process.cwd();
const entry = path.join(root, "virtual-fixture.tsx");

test("Vite keeps a globally configured JSX import source", async () => {
  const fixture: Plugin = {
    name: "fixture",
    enforce: "pre",
    resolveId: (id) => (id === entry ? entry : null),
    load: (id) =>
      id === entry ? 'export const view = <div id="x"><span /></div>;' : null,
  };
  const result = await build({
    configFile: false,
    root,
    logLevel: "silent",
    plugins: [
      fixture,
      sourceTrace({ enabled: true, root }),
      react({ jsxImportSource: "@fluentui/react-jsx-runtime" }),
    ],
    build: {
      write: false,
      minify: false,
      lib: { entry, formats: ["es"], fileName: "fixture" },
      rollupOptions: {
        external: [/^react/, /^@fluentui\//],
      },
    },
  });
  const output = (
    Array.isArray(result) ? result[0] : result
  ) as Rollup.RollupOutput;
  const code = output.output
    .map((item) => (item.type === "chunk" ? item.code : ""))
    .join("\n");
  assert.match(code, /from "@fluentui\/react-jsx-runtime\/jsx-runtime"/);
  assert.match(code, /from "react-sourcetrace\/runtime"/);
  assert.doesNotMatch(code, /from "react\/jsx-runtime"/);
  assert.match(code, /"name": "span"/);
});
