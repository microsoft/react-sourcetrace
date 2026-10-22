import { expect, test, type Page } from "@playwright/test";
import { enableSourceTrace, readSourceTrace } from "../../src/playwright.js";

const errors = new WeakMap<Page, string[]>();
const attributes =
  "[data-sourcetrace-src], [data-sourcetrace-stack], [data-sourcetrace-coverage], [__sourcetrace]";

test.beforeEach(({ page }) => {
  const messages: string[] = [];
  errors.set(page, messages);
  page.on("pageerror", (error) => messages.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") messages.push(message.text());
  });
});

async function openPropertyApp(page: Page): Promise<void> {
  await enableSourceTrace(page, { storage: "property" });
  // A default activation must not overwrite a more specific init script.
  await enableSourceTrace(page);
  await page.goto("./");
  await expect(page.locator("#first")).toBeVisible();
  await expect(page.locator("#lazy")).toBeVisible();
}

test.describe("property-only output", () => {
  test.beforeEach(async ({ page }) => {
    await openPropertyApp(page);
  });

  test.afterEach(({ page }) => {
    expect(errors.get(page)).toEqual([]);
  });

  test("stores complete non-enumerable traces on HTML, SVG, portals and resources", async ({
    page,
  }, testInfo) => {
    const first = await readSourceTrace(page.locator("#first"));
    const second = await readSourceTrace(page.locator("#second"));
    expect(first.source).toMatchObject({
      file: "demo/Button.tsx",
      name: "button",
    });
    expect(second.source).toEqual(first.source);
    expect(second.stack).not.toEqual(first.stack);
    expect(
      await page.locator("#first").evaluate((node) => node.__sourceTrace),
    ).toEqual(first);
    await expect(page.locator(attributes)).toHaveCount(0);
    expect(
      await page.evaluate(() =>
        [...document.querySelectorAll("#root *")].every((node) =>
          Object.hasOwn(node, "__sourceTrace"),
        ),
      ),
    ).toBe(true);

    const ids = [
      "first",
      "opaque",
      "circle",
      "custom-element",
      "portal",
      "lazy",
    ];
    if (String(testInfo.project.metadata.reactVersion).startsWith("19.")) {
      ids.push("traced-title", "traced-meta");
    }
    for (const id of ids) {
      const output = await page.locator(`#${id}`).evaluate((node) => {
        const api = window.__SOURCETRACE__;
        if (!api) throw new Error("Missing sourcetrace API.");
        const trace = api.inspect(node);
        const descriptor = Object.getOwnPropertyDescriptor(
          node,
          "__sourceTrace",
        );
        return {
          trace,
          sameInstance: trace === node.__sourceTrace,
          enumerable: descriptor?.enumerable,
          configurable: descriptor?.configurable,
          includedInKeys: Object.keys(node).includes("__sourceTrace"),
        };
      });
      expect(output.trace?.stack.length).toBeGreaterThan(0);
      expect(output.sameInstance).toBe(true);
      expect(output.enumerable).toBe(false);
      expect(output.configurable).toBe(true);
      expect(output.includedInKeys).toBe(false);
      if (id === "opaque") {
        expect(output.trace?.coverage).toBe("ancestor-only");
        expect(output.trace?.source).toBeNull();
      } else {
        expect(output.trace?.coverage).toBe("exact");
      }
    }
    await expect(page.locator("#prop-keys")).toHaveText("label");
  });

  test("flush leaves HTML, existing attributes and DOM mutation records unchanged", async ({
    page,
  }) => {
    const output = await page.evaluate(() => {
      const api = window.__SOURCETRACE__;
      const opaque = document.getElementById("opaque");
      if (!api || !opaque) throw new Error("Missing tracing fixture.");
      for (const name of [
        "data-sourcetrace-src",
        "data-sourcetrace-stack",
        "data-sourcetrace-coverage",
      ]) {
        opaque.setAttribute(name, "application-owned");
      }
      const before = document.documentElement.outerHTML;
      const observer = new MutationObserver(() => {});
      observer.observe(document, {
        attributes: true,
        childList: true,
        characterData: true,
        subtree: true,
      });
      api.flush();
      api.inspect(opaque);
      const mutationCount = observer.takeRecords().length;
      observer.disconnect();
      return {
        mutationCount,
        unchanged: before === document.documentElement.outerHTML,
        trace: opaque.__sourceTrace,
      };
    });
    expect(output.mutationCount).toBe(0);
    expect(output.unchanged).toBe(true);
    expect(output.trace?.coverage).toBe("ancestor-only");
  });

  test("updates reused hosts and removes stale properties when provenance disappears", async ({
    page,
  }) => {
    const changing = page.locator("#changing");
    const original = await changing.elementHandle();
    if (!original) throw new Error("Missing changing button.");
    const before = await readSourceTrace(changing);
    await page.locator("#flip").click();
    await expect.poll(() => readSourceTrace(changing)).not.toEqual(before);
    expect(await changing.evaluate((node, old) => node === old, original)).toBe(
      true,
    );
    expect(await changing.evaluate((node) => node.__sourceTrace)).toEqual(
      await readSourceTrace(changing),
    );
    await original.dispose();

    await page.evaluate(() => window.renderProvenanceProbe(true));
    const probe = page.locator("#provenance-probe");
    await expect(probe).toHaveText("Traced probe");
    expect((await readSourceTrace(probe)).coverage).toBe("exact");
    const host = await probe.elementHandle();
    if (!host) throw new Error("Missing provenance probe.");
    await page.evaluate(() => window.renderProvenanceProbe(false));
    await expect(probe).toHaveText("Untraced probe");
    expect(
      await probe.evaluate((node) => {
        const trace = window.__SOURCETRACE__?.inspect(node);
        return { trace, ownProperty: Object.hasOwn(node, "__sourceTrace") };
      }),
    ).toEqual({ trace: null, ownProperty: false });
    expect(await probe.evaluate((node, old) => node === old, host)).toBe(true);
    await host.dispose();
    await expect(page.locator(attributes)).toHaveCount(0);
  });
});

test("does not overwrite an application-owned property with the reserved name", async ({
  page,
}) => {
  await openPropertyApp(page);
  await page.evaluate(() => window.renderProvenanceProbe(false));
  const probe = page.locator("#provenance-probe");
  await expect(probe).toHaveText("Untraced probe");
  await probe.evaluate((node) => {
    Object.defineProperty(node, "__sourceTrace", {
      value: "application-owned",
      configurable: true,
    });
  });
  await page.evaluate(() => window.renderProvenanceProbe(true));
  await expect(probe).toHaveText("Traced probe");
  const message =
    "[react-sourcetrace] Element property __sourceTrace is reserved.";
  await expect(
    page.evaluate(() => window.__SOURCETRACE__?.flush()),
  ).rejects.toThrow(message);
  expect(
    await probe.evaluate(
      (node) => Object.getOwnPropertyDescriptor(node, "__sourceTrace")?.value,
    ),
  ).toBe("application-owned");
  await probe.evaluate((node) => {
    delete node.__sourceTrace;
  });
  await readSourceTrace(probe);
  expect(errors.get(page)?.filter((error) => error !== message)).toEqual([]);
});

test("rejects unsupported storage modes instead of silently adding attributes", async ({
  page,
}) => {
  await page.addInitScript(
    "window.__SOURCETRACE_ENABLED__ = true; window.__SOURCETRACE_STORAGE__ = 'invalid';",
  );
  await page.goto("./");
  const message =
    '[react-sourcetrace] Unsupported storage mode: invalid. Use "attributes" or "property".';
  await expect.poll(() => errors.get(page)).toContain(message);
  expect(errors.get(page)?.filter((error) => error !== message)).toEqual([]);
  expect(await page.evaluate(() => window.__SOURCETRACE__)).toBeUndefined();
  await expect(page.locator(attributes)).toHaveCount(0);
});
