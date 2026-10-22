import type { Locator, Page } from "@playwright/test";
import type { SourceTrace, SourceTraceStorage } from "./types.js";

export async function enableSourceTrace(
  page: Page,
  options: { storage?: SourceTraceStorage } = {},
): Promise<void> {
  await page.addInitScript(({ storage }) => {
    window.__SOURCETRACE_ENABLED__ = true;
    if (storage !== undefined) window.__SOURCETRACE_STORAGE__ = storage;
  }, options);
}

export async function readSourceTrace(locator: Locator): Promise<SourceTrace> {
  return locator.evaluate((element) => {
    const traceApi = window.__SOURCETRACE__;
    if (!traceApi) {
      throw new Error(
        "[react-sourcetrace] Tracing is unavailable. Enable the build transform and call enableSourceTrace before navigation.",
      );
    }
    const trace = traceApi.inspect(element);
    if (!trace) {
      throw new Error(
        "[react-sourcetrace] No instrumented React ancestry for this element.",
      );
    }
    return trace;
  });
}
