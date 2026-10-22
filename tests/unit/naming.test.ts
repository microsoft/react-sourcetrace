import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));

test("source, documentation, configuration and tests use consistent sourcetrace names", () => {
  const files = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(root, entry.name));
  for (const directory of ["src", "demo", "tests", ".github"]) {
    files.push(
      ...readdirSync(path.join(root, directory), {
        recursive: true,
        withFileTypes: true,
      })
        .filter((entry) => entry.isFile())
        .map((entry) => path.join(entry.parentPath, entry.name)),
    );
  }
  for (const file of files) {
    if (!/\.(?:[cm]?[jt]sx?|json|md|html|ya?ml)$/.test(file)) continue;
    assert.doesNotMatch(
      readFileSync(file, "utf8"),
      /(?:src|source)[ _-]?tracer/i,
      path.relative(root, file),
    );
  }
});

test("demo configuration reads SOURCETRACE_BUILD", () => {
  const script = `
import assert from "node:assert/strict";
import path from "node:path";
import config from "./vite.config.ts";
const plugin = config.plugins[0];
assert.equal(plugin.name, "react-sourcetrace");
const result = plugin.transform(
  "export const view = <button />;",
  path.join(process.cwd(), "fixture.tsx"),
);
if (process.env.SOURCETRACE_BUILD !== "1") {
  assert.equal(result, null);
} else {
  assert.ok(result.code.startsWith("/* @sourcetrace-instrumented */"));
  assert.ok(result.code.includes('from "react-sourcetrace/runtime"'));
  assert.ok(result.code.includes("__sourcetrace(<button />, "));
}
`;
  for (const [build, jsx] of [
    ["0", "automatic"],
    ["1", "automatic"],
    ["1", "classic"],
  ]) {
    execFileSync(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", script],
      {
        cwd: root,
        env: {
          ...process.env,
          SOURCETRACE_BUILD: build,
          SOURCETRACE_JSX: jsx,
        },
        stdio: "pipe",
      },
    );
  }
});
