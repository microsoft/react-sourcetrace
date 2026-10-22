import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { enableSourceTrace, readSourceTrace } from "../../src/playwright.js";

function location(snippet: string) {
  const file = "demo/React19Features.tsx";
  const code = readFileSync(
    path.join(process.cwd(), "demo", "React19Features.tsx"),
    "utf8",
  );
  const offset = code.indexOf(snippet);
  expect(offset).toBeGreaterThanOrEqual(0);
  const prefix = code.slice(0, offset);
  return {
    file,
    line: prefix.split("\n").length,
    column: offset - prefix.lastIndexOf("\n"),
  };
}

test.beforeEach(async ({ page }) => {
  await enableSourceTrace(page);
  await page.goto("./");
});

test("hoisted metadata retains original source and component ancestry", async ({
  page,
}) => {
  for (const [id, snippet] of [
    ["traced-title", "<title"],
    ["traced-meta", "<meta"],
  ] as const) {
    const element = page.locator(`#${id}`);
    await expect(element).toBeAttached();
    const trace = await readSourceTrace(element);
    expect(trace.source).toMatchObject(location(snippet));
    expect(trace.coverage).toBe("exact");
    expect(trace.stack.some((frame) => frame.name === "React19Features")).toBe(
      true,
    );
    expect(await element.evaluate((node) => node.parentElement?.tagName)).toBe(
      "HEAD",
    );
  }
});

test("function-component ref props and cleanup callbacks remain untouched", async ({
  page,
}) => {
  const button = page.locator("#ref-prop-button");
  await expect(button).toBeAttached();
  const before = await page.evaluate(() => ({
    attaches: Number(document.documentElement.dataset.react19RefAttaches),
    cleanups: Number(document.documentElement.dataset.react19RefCleanups ?? 0),
  }));
  expect(before.attaches).toBeGreaterThan(0);
  const trace = await readSourceTrace(button);
  expect(trace.source).toMatchObject(location("<button"));
  expect(trace.stack).toContainEqual({
    ...location("<RefPropButton"),
    name: "RefPropButton",
  });
  await page.locator("#toggle-ref-prop").click();
  await expect(button).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      Number(document.documentElement.dataset.react19RefCleanups),
    ),
  ).toBe(before.cleanups + 1);
  await page.locator("#toggle-ref-prop").click();
  await expect(button).toBeAttached();
  expect((await readSourceTrace(button)).source).toEqual(trace.source);
});
