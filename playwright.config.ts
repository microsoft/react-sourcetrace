import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { reactVersions } from "./tests/react-versions.js";

const production = [
  "automatic",
  "classic",
  "ts-automatic",
  "ts-classic",
  "loader-classic",
  "rspack-classic",
  "rspack-automatic",
];
const port = Number(process.env.SOURCETRACE_TEST_PORT ?? 48170);

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  workers: 3,
  forbidOnly: true,
  retries: 0,
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    headless: true,
    trace: "retain-on-failure",
  },
  projects: reactVersions.flatMap((version, versionIndex) => [
    ...["automatic", "classic"].map((name, index) => ({
      name: `${version.prefix}${name}-development`,
      testMatch:
        version.name === "react19"
          ? ["**/tracing.spec.ts", "**/property.spec.ts", "**/react19.spec.ts"]
          : ["**/tracing.spec.ts", "**/property.spec.ts"],
      metadata: { reactVersion: version.version },
      use: { baseURL: `http://127.0.0.1:${port + versionIndex * 2 + index}` },
    })),
    ...production.map((name) => ({
      name: `${version.prefix}${name}-production`,
      testMatch:
        version.name === "react19"
          ? ["**/tracing.spec.ts", "**/property.spec.ts", "**/react19.spec.ts"]
          : ["**/tracing.spec.ts", "**/property.spec.ts"],
      metadata: { reactVersion: version.version },
      use: {
        baseURL: `http://127.0.0.1:${port + 4}/${version.prefix}${name}/`,
      },
    })),
    {
      name: `${version.prefix}build-disabled`,
      testMatch: "**/disabled.spec.ts",
      metadata: { reactVersion: version.version },
      use: {
        baseURL: `http://127.0.0.1:${port + 4}/${version.prefix}disabled/`,
      },
    },
    {
      name: `${version.prefix}build-disabled-classic`,
      testMatch: "**/disabled.spec.ts",
      metadata: { reactVersion: version.version },
      use: {
        baseURL: `http://127.0.0.1:${port + 4}/${version.prefix}disabled-classic/`,
      },
    },
  ]),
  webServer: [
    ...reactVersions.flatMap((version, versionIndex) =>
      ["automatic", "classic"].map((runtime, runtimeIndex) => ({
        command: `node --import tsx "${path.join("tests", "dev-server.ts")}" ${runtime} ${port + versionIndex * 2 + runtimeIndex} ${version.name}`,
        url: `http://127.0.0.1:${port + versionIndex * 2 + runtimeIndex}`,
        reuseExistingServer: false,
      })),
    ),
    {
      command: `node --import tsx "${path.join("tests", "production-server.ts")}" ${port + 4}`,
      url: `http://127.0.0.1:${port + 4}/automatic/`,
      timeout: 120_000,
      reuseExistingServer: false,
    },
  ],
});
