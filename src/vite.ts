import type { Plugin } from "vite";
import { instrumentSource, type SourceTraceOptions } from "./instrument.js";

export function sourceTrace(options: SourceTraceOptions): Plugin {
  return {
    name: "react-sourcetrace",
    enforce: "pre",
    transform(code, id) {
      return instrumentSource(code, id.split("?")[0] ?? id, options);
    },
  };
}
