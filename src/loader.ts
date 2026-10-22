import { instrumentSource, type SourceTraceOptions } from "./instrument.js";

interface LoaderContext {
  resourcePath: string;
  rootContext: string;
  getOptions(): Partial<SourceTraceOptions>;
  callback(error: Error | null, code?: string, map?: object): void;
}

export default function sourceTraceLoader(
  this: LoaderContext,
  code: string,
  inputMap?: object,
): void {
  const options = this.getOptions();
  if (inputMap && options.enabled) {
    throw new Error(
      "[react-sourcetrace] Run this loader with enforce: 'pre' on original JSX, before other source transforms.",
    );
  }
  const result = instrumentSource(code, this.resourcePath, {
    ...options,
    root: options.root ?? this.rootContext,
  });
  this.callback(null, result?.code ?? code, result?.map ?? inputMap);
}
