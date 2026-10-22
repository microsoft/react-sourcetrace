import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export const reactVersions = [
  {
    name: "react18",
    prefix: "",
    version: "18.3.1",
    react: "react",
    dom: "react-dom",
  },
  {
    name: "react19",
    prefix: "react19-",
    version: "19.3.1",
    react: "react19",
    dom: "react-dom19",
  },
] as const;

export function reactAliases(name: string): Record<string, string> {
  const version = reactVersions.find((candidate) => candidate.name === name);
  if (!version) throw new Error(`Unknown React test version: ${name}`);
  return {
    react: path.dirname(require.resolve(`${version.react}/package.json`)),
    "react-dom": path.dirname(require.resolve(`${version.dom}/package.json`)),
  };
}
