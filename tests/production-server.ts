import path from "node:path";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { rspack } from "@rspack/core";
import { build, preview, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { sourceTrace } from "../src/vite.js";
import { createSourceTraceTransformers } from "../src/typescript.js";
import sourceTraceLoader from "../src/loader.js";
import { reactAliases, reactVersions } from "./react-versions.js";

const root = process.cwd();
for (const reactVersion of reactVersions) {
  const aliases = reactAliases(reactVersion.name);
  for (const name of [
    "automatic",
    "classic",
    "ts-automatic",
    "ts-classic",
    "loader-classic",
    "disabled",
    "disabled-classic",
  ]) {
    const classic = name.endsWith("classic");
    let instrumentation: Plugin;
    if (name.startsWith("ts-")) {
      instrumentation = {
        name: "test-typescript-emit",
        enforce: "pre",
        transform(code, id) {
          if (!id.endsWith(".tsx") || id.includes("node_modules")) return null;
          const output = ts.transpileModule(code, {
            fileName: id,
            compilerOptions: {
              target: ts.ScriptTarget.ES2022,
              module: ts.ModuleKind.ESNext,
              jsx: classic ? ts.JsxEmit.React : ts.JsxEmit.ReactJSX,
              sourceMap: true,
            },
            transformers: createSourceTraceTransformers({
              enabled: true,
              root,
            }),
          });
          return {
            code: output.outputText,
            map: output.sourceMapText ?? null,
          };
        },
      };
    } else if (name.startsWith("loader-")) {
      instrumentation = {
        name: "test-pre-loader",
        enforce: "pre",
        transform(code, id) {
          if (!id.endsWith(".tsx")) return null;
          let result: { code: string; map: string | null } | undefined;
          sourceTraceLoader.call(
            {
              resourcePath: id,
              rootContext: root,
              getOptions: () => ({ enabled: true }),
              callback(error, transformed, map) {
                if (error) throw error;
                result = {
                  code: transformed ?? code,
                  map: map ? JSON.stringify(map) : null,
                };
              },
            },
            code,
          );
          return result;
        },
      };
    } else {
      instrumentation = sourceTrace({
        enabled: !name.startsWith("disabled"),
        root,
      });
    }
    await build({
      configFile: false,
      base: `/${reactVersion.prefix}${name}/`,
      resolve: { alias: aliases },
      plugins: [
        instrumentation,
        react({ jsxRuntime: classic ? "classic" : "automatic" }),
      ],
      build: {
        outDir: path.join(root, ".generated", `${reactVersion.prefix}${name}`),
        sourcemap: true,
      },
      logLevel: "warn",
    });
  }
  for (const jsxRuntime of ["classic", "automatic"] as const) {
    const name = `${reactVersion.prefix}rspack-${jsxRuntime}`;
    const compiler = rspack({
      mode: "production",
      context: root,
      entry: path.join(root, "demo", "main.tsx"),
      output: {
        path: path.join(root, ".generated", name),
        filename: "app.js",
        publicPath: `/${name}/`,
        clean: true,
      },
      devtool: "source-map",
      resolve: {
        alias: aliases,
        extensions: [".tsx", ".ts", ".js"],
        extensionAlias: { ".js": [".js", ".ts", ".tsx"] },
      },
      module: {
        rules: [
          {
            test: /\.tsx$/,
            exclude: /node_modules/,
            enforce: "pre",
            use: [
              {
                loader: path.join(root, "dist", "loader.js"),
                options: { enabled: true, root },
              },
            ],
          },
          {
            test: /\.tsx?$/,
            exclude: /node_modules/,
            use: [
              {
                loader: "builtin:swc-loader",
                options: {
                  sourceMaps: true,
                  jsc: {
                    target: "es2022",
                    parser: {
                      syntax: "typescript",
                      tsx: true,
                      decorators: true,
                    },
                    transform: { react: { runtime: jsxRuntime } },
                  },
                },
              },
            ],
          },
          { test: /\.css$/, type: "asset/source" },
        ],
      },
      plugins: [
        new rspack.HtmlRspackPlugin({
          templateContent: readFileSync(
            path.join(root, "index.html"),
            "utf8",
          ).replace(
            /<script\b[^>]*src="\/demo\/main\.tsx"[^>]*><\/script>/,
            "",
          ),
        }),
      ],
    });
    await new Promise<void>((resolve, reject) => {
      compiler.run((error, stats) => {
        compiler.close((closeError) => {
          if (error || closeError) {
            reject(error ?? closeError);
          } else if (!stats || stats.hasErrors()) {
            reject(
              new Error(
                stats?.toString({ all: false, errors: true }) ??
                  "Missing Rspack stats",
              ),
            );
          } else {
            resolve();
          }
        });
      });
    });
  }
}
const server = await preview({
  configFile: false,
  build: { outDir: path.join(root, ".generated") },
  preview: {
    host: "127.0.0.1",
    port: Number(process.argv[2]),
    strictPort: true,
  },
});
server.printUrls();
