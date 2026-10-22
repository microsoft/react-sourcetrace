import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

interface PackageManifest {
  name: string;
  version: string;
  license: string;
  private?: boolean;
  exports: Record<string, { types: string; default: string }>;
  dependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
}

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const manifest: PackageManifest = JSON.parse(
  readFileSync(path.join(projectRoot, "package.json"), "utf8"),
);

test("published tarball works without checkout aliases or unpublished files", () => {
  assert.equal(manifest.name, "react-sourcetrace");
  assert.equal(manifest.license, "MIT");
  assert.notEqual(manifest.private, true);
  const archive = path.join(
    projectRoot,
    ".package-check",
    `${manifest.name}-${manifest.version}.tgz`,
  );
  assert.ok(
    existsSync(archive),
    "Run npm run test:package to build the tarball.",
  );
  const entries = execFileSync("tar", ["-tzf", archive], {
    encoding: "utf8",
  })
    .trim()
    .split(/\r?\n/);
  for (const entry of entries) {
    assert.match(
      entry,
      /^package\/(?:package\.json|README\.md|LICENSE|(?:src|dist)\/.+)$/,
    );
    assert.ok(!entry.split("/").includes(".."));
    const built = /^package\/dist\/(.+?)\.(?:js|d\.ts)(?:\.map)?$/.exec(entry);
    if (built) {
      assert.ok(
        entries.includes(`package/src/${built[1]}.ts`),
        `Stale build output: ${entry}`,
      );
    }
  }

  const consumer = mkdtempSync(
    path.join(tmpdir(), "react-sourcetrace-package-"),
  );
  try {
    const modules = path.join(consumer, "node_modules");
    const installed = path.join(modules, manifest.name);
    mkdirSync(installed, { recursive: true });
    execFileSync("tar", [
      "-xzf",
      archive,
      "-C",
      installed,
      "--strip-components",
      "1",
    ]);
    for (const entry of entries) {
      const filename = path.join(installed, ...entry.split("/").slice(1));
      assert.ok(existsSync(filename), entry);
      assert.doesNotMatch(
        readFileSync(filename, "utf8"),
        /(?:src|source)[ _-]?tracer|C:\\(?:react-sourcetrace|tmp)\b/i,
      );
      if (filename.endsWith(".map")) {
        const map: { sources: string[]; sourceRoot: string } = JSON.parse(
          readFileSync(filename, "utf8"),
        );
        for (const source of map.sources) {
          const original = path.resolve(
            path.dirname(filename),
            map.sourceRoot,
            source,
          );
          assert.ok(original.startsWith(`${installed}${path.sep}`));
          assert.ok(existsSync(original), `Missing map source: ${original}`);
        }
      }
    }
    for (const entry of Object.values(manifest.exports)) {
      for (const target of [entry.types, entry.default]) {
        assert.ok(target.startsWith("./dist/"));
        assert.ok(existsSync(path.join(installed, target)), target);
      }
    }
    for (const dependency of new Set([
      ...Object.keys(manifest.dependencies),
      ...Object.keys(manifest.peerDependencies),
      "@types/react",
      "@types/node",
    ])) {
      const destination = path.join(modules, ...dependency.split("/"));
      mkdirSync(path.dirname(destination), { recursive: true });
      symlinkSync(
        path.join(projectRoot, "node_modules", ...dependency.split("/")),
        destination,
        process.platform === "win32" ? "junction" : "dir",
      );
    }
    writeFileSync(
      path.join(consumer, "package.json"),
      JSON.stringify({ private: true, type: "module" }),
    );
    writeFileSync(
      path.join(consumer, "consumer.mjs"),
      `
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";
import { build } from "vite";
import { createSourceTraceTransformers } from "react-sourcetrace/typescript";
import { sourceTrace } from "react-sourcetrace/vite";
const require = createRequire(import.meta.url);
for (const subpath of ${JSON.stringify(Object.keys(manifest.exports))}) {
  const name = "react-sourcetrace" + (subpath === "." ? "" : subpath.slice(1));
  assert.ok(await import(name));
  assert.ok(require.resolve(name).startsWith(process.cwd()));
}
assert.equal(sourceTrace({ root: process.cwd() }).name, "react-sourcetrace");
const result = ts.transpileModule(
  'export const view = <button id="packed">Packed</button>;',
  {
    fileName: path.join(process.cwd(), "view.tsx"),
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext },
    transformers: createSourceTraceTransformers({
      root: process.cwd(), enabled: true,
    }),
  },
);
assert.ok(result.outputText.includes('"react-sourcetrace/runtime"'));
fs.writeFileSync("compiled.mjs", result.outputText);
const { view } = await import("./compiled.mjs");
assert.equal(view.type, "button");
assert.deepEqual(view.props, { id: "packed", children: "Packed" });
const commonjs = ts.transpileModule(
  'export const view = <button id="required" />;',
  {
    fileName: path.join(process.cwd(), "view.tsx"),
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
    transformers: createSourceTraceTransformers({
      root: process.cwd(), enabled: true,
    }),
  },
);
fs.writeFileSync("compiled.cjs", commonjs.outputText);
assert.equal(require("./compiled.cjs").view.props.id, "required");
const bundled = await build({
  configFile: false,
  root: process.cwd(),
  logLevel: "silent",
  build: {
    write: false,
    lib: {
      entry: path.join(process.cwd(), "compiled.mjs"),
      formats: ["es"],
      fileName: "consumer",
    },
  },
});
const outputs = Array.isArray(bundled) ? bundled : [bundled];
assert.ok(outputs.every(output =>
  "output" in output && output.output.some(chunk => chunk.type === "chunk")
));
`,
    );
    execFileSync(process.execPath, ["consumer.mjs"], {
      cwd: consumer,
      stdio: "pipe",
    });
    writeFileSync(
      path.join(consumer, "consumer.tsx"),
      `
import { recordElement, type SourceTrace, type SourceTraceApi } from "react-sourcetrace";
import { sourceTrace } from "react-sourcetrace/vite";
import { createSourceTraceTransformers } from "react-sourcetrace/typescript";
import loader from "react-sourcetrace/loader";
import { enableSourceTrace, readSourceTrace } from "react-sourcetrace/playwright";
const view = recordElement(<button id="typed">Typed</button>, {
  file: "consumer.tsx", line: 7, column: 26, name: "button",
});
const typed: string = view.props.id;
const trace: SourceTrace | undefined = document.body.__sourceTrace;
const api: SourceTraceApi | undefined = window.__SOURCETRACE__;
window.__SOURCETRACE_ENABLED__ = true;
window.__SOURCETRACE_STORAGE__ = "property";
void [typed, trace, api, sourceTrace, createSourceTraceTransformers,
  loader, enableSourceTrace, readSourceTrace];
`,
    );
    execFileSync(
      process.execPath,
      [
        path.join(projectRoot, "node_modules", "typescript", "bin", "tsc"),
        "--noEmit",
        "--strict",
        "--skipLibCheck",
        "--module",
        "NodeNext",
        "--moduleResolution",
        "NodeNext",
        "--target",
        "ES2022",
        "--lib",
        "ES2022,DOM",
        "--jsx",
        "react-jsx",

        "consumer.tsx",
      ],
      { cwd: consumer, stdio: "pipe" },
    );
    execFileSync(
      process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "npm",
      process.platform === "win32"
        ? ["/d", "/s", "/c", "npm run version:bump -- patch"]
        : ["run", "version:bump", "--", "patch"],
      { cwd: installed, stdio: "pipe" },
    );
    const bumped: PackageManifest = JSON.parse(
      readFileSync(path.join(installed, "package.json"), "utf8"),
    );
    assert.notEqual(bumped.version, manifest.version);
    assert.match(bumped.version, /^\d+\.\d+\.\d+$/);
    assert.ok(!existsSync(path.join(installed, ".git")));
  } finally {
    rmSync(consumer, { recursive: true, force: true });
  }
});
