export interface SourceLocation {
  file: string;
  line: number;
  column: number;
  name: string;
}

export interface SourceFrame extends SourceLocation {
  key?: string;
}

export interface SourceTrace {
  source: SourceLocation | null;
  stack: SourceFrame[];
  coverage: "exact" | "ancestor-only";
}

export type SourceTraceStorage = "attributes" | "property";

export interface SourceTraceApi {
  flush(): void;
  inspect(element: Element): SourceTrace | null;
}

declare global {
  interface Window {
    __SOURCETRACE_ENABLED__?: boolean;
    __SOURCETRACE_STORAGE__?: SourceTraceStorage;
    __SOURCETRACE__?: SourceTraceApi;
  }
  interface Element {
    __sourceTrace?: SourceTrace;
  }
}
