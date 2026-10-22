import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { enableSourceTrace, readSourceTrace } from "../../src/playwright.js";

function location(file: string, snippet: string, occurrence = 0) {
  const code = readFileSync(
    path.join(process.cwd(), ...file.split("/")),
    "utf8",
  );
  let offset = -1;
  for (let index = 0; index <= occurrence; index++) {
    offset = code.indexOf(snippet, offset + 1);
    if (offset === -1) throw new Error(`Missing fixture snippet: ${snippet}`);
  }
  const prefix = code.slice(0, offset);
  return {
    file,
    line: prefix.split("\n").length,
    column: offset - prefix.lastIndexOf("\n"),
  };
}

const buttonSource = location("demo/Button.tsx", "<button");
const errors = new WeakMap<Page, string[]>();

test.beforeEach(({ page }) => {
  const messages: string[] = [];
  errors.set(page, messages);
  page.on("pageerror", (error) => messages.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") messages.push(message.text());
  });
});

test.afterEach(({ page }) => {
  expect(errors.get(page)).toEqual([]);
});

test.describe("enabled tracing", () => {
  test.beforeEach(async ({ page }) => {
    await enableSourceTrace(page, { storage: "attributes" });
    await page.goto("./");
    await expect(page.locator("#first")).toBeVisible();
  });

  test("runs the requested React renderer rather than a mislabeled alias", async ({
    page,
  }, testInfo) => {
    await expect(page.locator("main")).toHaveAttribute(
      "data-react-version",
      testInfo.project.metadata.reactVersion,
    );
  });

  test("identical component outputs retain distinct instantiation sites", async ({
    page,
  }) => {
    const first = await readSourceTrace(page.locator("#first"));
    const second = await readSourceTrace(page.locator("#second"));
    expect(first.source).toEqual({ ...buttonSource, name: "button" });
    expect(second.source).toEqual(first.source);
    expect(first.stack).toContainEqual({
      ...location("demo/App.tsx", '<Button id="first"'),
      name: "Button",
    });
    expect(second.stack).toContainEqual({
      ...location("demo/App.tsx", '<Button id="second"'),
      name: "Button",
    });
    expect(first.stack).toContainEqual({
      ...location("demo/main.tsx", "<App"),
      name: "App",
    });
    expect(first.stack).not.toEqual(second.stack);
    await expect(page.locator("#first")).toHaveAttribute(
      "data-sourcetrace-src",
      `${buttonSource.file}:${buttonSource.line}:${buttonSource.column}`,
    );
    expect(
      JSON.parse(
        (await page.locator("#first").getAttribute("data-sourcetrace-stack"))!,
      ),
    ).toEqual(first.stack);
  });

  test("every authored DOM element receives exact metadata without extra DOM wrappers", async ({
    page,
  }) => {
    await expect(page.locator("#lazy")).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => {
          window.__SOURCETRACE__?.flush();
          return [...document.querySelectorAll("#root *, #portal-root *")]
            .filter((element) => element.id !== "opaque")
            .filter((element) => !element.hasAttribute("data-sourcetrace-src"))
            .map((element) => element.outerHTML);
        }),
      )
      .toEqual([]);
    expect(
      await page
        .locator("#first")
        .evaluate((element) => element.parentElement?.tagName),
    ).toBe("MAIN");
    expect(
      await page
        .locator("#first")
        .evaluate((element) => element.getAttributeNames()),
    ).toEqual(
      expect.arrayContaining([
        "id",
        "data-sourcetrace-src",
        "data-sourcetrace-stack",
        "data-sourcetrace-coverage",
      ]),
    );
    await expect(page.locator("[__sourcetrace]")).toHaveCount(0);
    await expect(page.locator("#prop-keys")).toHaveText("label");
  });

  test("state updates do not change source coordinates or remount components", async ({
    page,
  }) => {
    const button = page.locator("#first");
    const before = await readSourceTrace(button);
    await button.click();
    await expect(button).toHaveText("first: 1");
    await page.locator("#flip").click();
    await expect(button).toHaveText("first: 1");
    expect(await readSourceTrace(button)).toEqual(before);
  });

  test("Fluent slot factories preserve custom renderers and nested source locations", async ({
    page,
  }) => {
    const root = page.locator("#fluent-slot");
    await expect(root).toHaveText("Fluent slot");
    await expect(root).toHaveAttribute("data-supplied", "yes");
    expect((await readSourceTrace(root)).source).toMatchObject(
      location("demo/FluentFeatures.tsx", "<slots.root"),
    );
    const custom = await readSourceTrace(page.locator("#fluent-custom"));
    expect(custom.source).toMatchObject(
      location("demo/FluentFeatures.tsx", "<button"),
    );
    expect(custom.stack).toContainEqual({
      ...location("demo/FluentFeatures.tsx", "<slots.custom"),
      name: "slots.custom",
    });
    expect(
      (await readSourceTrace(page.locator("#fluent-spread"))).source,
    ).toMatchObject(location("demo/FluentFeatures.tsx", "<slots.spread"));
    await expect(page.locator("#fluent-features > *")).toHaveCount(3);
    await expect(page.locator("[__sourcetrace]")).toHaveCount(0);
  });

  test("application-owned source attributes survive tracing and React updates", async ({
    page,
  }) => {
    const element = page.locator("#application-attributes");
    const before = await readSourceTrace(element);
    await expect(element).toHaveAttribute("data-src", "application-image.png");
    await expect(element).toHaveAttribute(
      "data-src-stack",
      "application-stack",
    );
    await expect(element).toHaveAttribute(
      "data-src-coverage",
      "application-coverage",
    );
    await page.locator("#flip").click();
    await expect(element).toHaveAttribute(
      "data-src",
      "application-updated.png",
    );
    expect((await readSourceTrace(element)).source).toEqual(before.source);
  });

  test("same DOM instance changes provenance when only its JSX call site changes", async ({
    page,
  }) => {
    const button = page.locator("#changing");
    await button.click();
    const before = await readSourceTrace(button);
    expect(before.stack).toContainEqual({
      ...location("demo/App.tsx", '<Button id="changing"', 1),
      name: "Button",
    });
    await page.locator("#flip").click();
    await expect(button).toHaveText("changing: 1");
    const after = await readSourceTrace(button);
    expect(after.stack).toContainEqual({
      ...location("demo/App.tsx", '<Button id="changing"', 0),
      name: "Button",
    });
    expect(after.stack).not.toEqual(before.stack);
    expect(after.source).toEqual(before.source);
    // Wait for the autonomous annotation too, not just inspect()'s explicit flush.
    await page.locator("#flip").click();
    await expect(button).toHaveAttribute(
      "data-sourcetrace-stack",
      JSON.stringify(before.stack),
    );
  });

  test("memo, forwardRef and class instances keep their identities and refs", async ({
    page,
  }) => {
    const memo = await readSourceTrace(page.locator("#memo"));
    expect(memo.stack).toContainEqual({
      ...location("demo/App.tsx", '<MemoButton id="memo"'),
      name: "MemoButton",
    });
    const forwarded = await readSourceTrace(page.locator("#forward"));
    expect(forwarded.source).toMatchObject(
      location("demo/App.tsx", "<button {...props}"),
    );
    expect(forwarded.stack).toContainEqual({
      ...location("demo/App.tsx", '<ForwardButton id="forward"'),
      name: "ForwardButton",
    });
    await page.locator("#focus-forward").click();
    await expect(page.locator("#forward")).toBeFocused();
    expect(
      (await readSourceTrace(page.locator("#class-button"))).source,
    ).toMatchObject(location("demo/App.tsx", '<button id="class-button"'));
  });

  test("slotted children include committed render ancestry", async ({
    page,
  }) => {
    const trace = await readSourceTrace(page.locator("#slotted"));
    expect(trace.stack).toContainEqual({
      ...location("demo/App.tsx", '<Button id="slotted"'),
      name: "Button",
    });
    expect(trace.stack).toContainEqual({
      ...location("demo/App.tsx", "<Slot>"),
      name: "Slot",
    });
  });

  test("keyed instances stay distinguishable through reordering", async ({
    page,
  }) => {
    expect(
      (await readSourceTrace(page.locator("#spread-key"))).stack,
    ).toContainEqual({
      ...location("demo/App.tsx", '<Button {...{ id: "spread-key"'),
      name: "Button",
      key: "spread-key",
    });
    await page.locator("#key-a").click();
    for (const key of ["a", "b"]) {
      const trace = await readSourceTrace(page.locator(`#key-${key}`));
      expect(trace.stack).toContainEqual({
        ...location("demo/App.tsx", "<Button key={key}"),
        name: "Button",
        key,
      });
    }
    await page.locator("#reorder").click();
    await expect(page.locator("#key-a")).toHaveText("key-a: 1");
    expect(
      (await readSourceTrace(page.locator("#key-a"))).stack.some(
        (frame) => frame.key === "a",
      ),
    ).toBe(true);
  });

  test("conditional mounts, lazy chunks, SVG, custom elements and portals are traced", async ({
    page,
  }) => {
    for (const [id, file, snippet] of [
      ["conditional", "demo/Button.tsx", "<button"],
      ["lazy", "demo/Button.tsx", "<button"],
      ["portal", "demo/Button.tsx", "<button"],
      ["circle", "demo/App.tsx", "<circle"],
      ["custom-element", "demo/App.tsx", "<my-widget"],
      ["explicit-fragment", "demo/App.tsx", '<span id="explicit-fragment"'],
    ] as const) {
      const element = page.locator(`#${id}`);
      await expect(element).toBeAttached();
      expect((await readSourceTrace(element)).source).toMatchObject(
        location(file, snippet),
      );
    }
    await page.locator("#toggle").click();
    await expect(page.locator("#conditional")).toHaveCount(0);
    await page.locator("#toggle").click();
    expect(
      (await readSourceTrace(page.locator("#conditional"))).source,
    ).toMatchObject(buttonSource);
    expect(
      (await readSourceTrace(page.locator("#portal"))).stack.some(
        (frame) => frame.name === "App",
      ),
    ).toBe(true);
  });

  test("an unmounted root does not break tracing of the remaining roots", async ({
    page,
  }) => {
    await page.evaluate(() => window.renderProvenanceProbe(true));
    await expect(page.locator("#provenance-probe")).toHaveText("Traced probe");
    await page.evaluate(() => window.unmountProvenanceProbe());
    await expect(page.locator("#provenance-probe")).toHaveCount(0);
    expect((await readSourceTrace(page.locator("#first"))).source).toEqual({
      ...buttonSource,
      name: "button",
    });
    // Let the observer-driven flush run so asynchronous errors are captured too.
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(resolve)),
    );
  });

  test("uninstrumented dependencies report ancestry without inventing an exact source", async ({
    page,
  }) => {
    const trace = await readSourceTrace(page.locator("#opaque"));
    expect(trace.source).toBeNull();
    expect(trace.coverage).toBe("ancestor-only");
    expect(trace.stack).toContainEqual({
      ...location("demo/App.tsx", "<OpaqueButton"),
      name: "OpaqueButton",
    });
    await expect(page.locator("#opaque")).not.toHaveAttribute(
      "data-sourcetrace-src",
    );
    await expect(page.locator("#opaque")).toHaveAttribute(
      "data-sourcetrace-coverage",
      "ancestor-only",
    );
  });

  test("React development source information still points at application JSX", async ({
    page,
  }, testInfo) => {
    test.skip(!testInfo.project.name.endsWith("-development"));
    await expect(page.locator("#lazy")).toBeVisible();
    const react18 = testInfo.project.metadata.reactVersion.startsWith("18.");
    const results = await page.evaluate((react18) => {
      window.__SOURCETRACE__?.flush();
      return [...document.querySelectorAll("[data-sourcetrace-src]")].map(
        (element) => {
          const key = Object.keys(element).find((name) =>
            name.startsWith("__reactFiber$"),
          )!;
          const fiber = Reflect.get(element, key) as {
            _debugSource?: { fileName: string; lineNumber: number };
            _debugStack?: Error;
          };
          const traced = element.getAttribute("data-sourcetrace-src")!;
          return react18
            ? {
                traced,
                file: fiber._debugSource?.fileName.replaceAll("\\", "/"),
                line: fiber._debugSource?.lineNumber,
              }
            : {
                traced,
                // React drops the factory's own frame; the next is the call site.
                caller: fiber._debugStack?.stack?.split("\n")[2],
              };
        },
      );
    }, react18);
    let compared = 0;
    for (const result of results) {
      const [file, line] = result.traced.split(":");
      if ("caller" in result) {
        if (result.caller === undefined) continue;
        expect(result.caller).not.toMatch(/react-sourcetrace|\/dist\//);
        // Fluent slots are created by Fluent's own runtime, with or without tracing.
        if (result.caller.includes("/node_modules/")) continue;
        expect(result.caller, result.traced).toMatch(/\/demo\/\w+\.tsx/);
      } else {
        if (!result.file?.endsWith(`/${file}`)) continue;
        expect(result.line, result.traced).toBe(Number(line));
      }
      compared++;
    }
    expect(compared).toBeGreaterThan(10);
  });
});

for (const storage of ["attributes", "property"] as const) {
  test(`an instrumented build stays inert without runtime opt-in (${storage})`, async ({
    page,
  }) => {
    await page.addInitScript((mode) => {
      window.__SOURCETRACE_STORAGE__ = mode;
    }, storage);
    await page.goto("./");
    await expect(page.locator("#first")).toBeVisible();
    await expect(page.locator("#lazy")).toBeVisible();
    await expect(
      page.locator(
        "[data-sourcetrace-src], [data-sourcetrace-stack], [__sourcetrace]",
      ),
    ).toHaveCount(0);
    expect(await page.evaluate(() => window.__SOURCETRACE__)).toBeUndefined();
    expect(
      await page.evaluate(() =>
        [...document.querySelectorAll("*")].some((element) =>
          Object.hasOwn(element, "__sourceTrace"),
        ),
      ),
    ).toBe(false);
    await expect(page.locator("#prop-keys")).toHaveText("label");
    await page.locator("#first").click();
    await expect(page.locator("#first")).toHaveText("first: 1");
  });
}

test("local URL opt-in enables default property tracing without an E2E init script", async ({
  page,
}) => {
  await page.goto("./?sourcetrace=1");
  await expect
    .poll(() =>
      page
        .locator("#first")
        .evaluate((element) => element.__sourceTrace?.source?.file),
    )
    .toBe("demo/Button.tsx");
  await expect(
    page.locator(
      "[data-sourcetrace-src], [data-sourcetrace-stack], [data-sourcetrace-coverage]",
    ),
  ).toHaveCount(0);
});

test("explicit attribute storage writes attributes without the private property", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.__SOURCETRACE_STORAGE__ = "attributes";
  });
  await page.goto("./?sourcetrace=1");
  await expect(page.locator("#first")).toHaveAttribute(
    "data-sourcetrace-src",
    /demo\/Button\.tsx:/,
  );
  expect(
    await page.evaluate(() =>
      [...document.querySelectorAll("*")].some((element) =>
        Object.hasOwn(element, "__sourceTrace"),
      ),
    ),
  ).toBe(false);
});

for (const storage of ["property", "attributes"] as const) {
  test.describe(`committed provenance (${storage})`, () => {
    test.beforeEach(async ({ page }) => {
      await enableSourceTrace(page, { storage });
      await page.goto("./");
      await expect(page.locator("#first")).toBeVisible();
      await page.evaluate(() => window.renderProvenanceFeatures());
      await expect(page.locator("#provenance-features")).toBeVisible();
    });

    test("shared fragments retain only their own committed sites across rerenders", async ({
      page,
    }) => {
      const file = "demo/ProvenanceFeatures.tsx";
      const first = {
        ...location(file, '<Fragment key="first">', 1),
        name: "Fragment",
        key: "first",
      };
      const second = {
        ...location(file, '<Fragment key="second">'),
        name: "Fragment",
        key: "second",
      };
      const other = {
        ...location(file, '<Fragment key="first">', 2),
        name: "Fragment",
        key: "first",
      };
      const read = () =>
        page.locator(".shared-fragment-child").evaluateAll((elements) =>
          elements.map((element) => {
            const trace = window.__SOURCETRACE__?.inspect(element);
            if (!trace) throw new Error("Missing shared-child trace.");
            return trace;
          }),
        );
      const before = await read();
      for (const trace of before) {
        expect(trace.source).toEqual({
          ...location(file, '<button className="shared-fragment-child"'),
          name: "button",
        });
      }
      expect(
        before.map((trace) =>
          trace.stack.filter((frame) => frame.name === "Fragment"),
        ),
      ).toEqual([[first], [second], [other], [], []]);
      for (let index = 0; index < 10; index++) {
        await page.locator("#flip-provenance").click();
        const after = await read();
        expect(after).toEqual(
          index % 2 === 0
            ? [before[1], before[0], before[2], before[3], before[4]]
            : before,
        );
      }
    });

    test("memo bailouts use retained call sites without rerendering or stale inner frames", async ({
      page,
    }) => {
      const file = "demo/ProvenanceFeatures.tsx";
      for (const id of ["memo-retained", "memo-compared", "memo-direct"]) {
        await page.locator(`#${id}`).click();
        await expect(page.locator(`#${id}`)).toHaveText("1");
      }
      const hosts = await page
        .locator("#memo-retained, #memo-compared, #memo-direct")
        .elementHandles();
      const renders = await Promise.all(
        hosts.map((host) => host.getAttribute("data-renders")),
      );
      await page.locator("#flip-provenance").click();
      for (const [id, name] of [
        ["memo-retained", "MemoCounter"],
        ["memo-compared", "ComparedCounter"],
      ] as const) {
        const trace = await readSourceTrace(page.locator(`#${id}`));
        expect(trace.stack.filter((frame) => frame.name === name)).toEqual([
          { ...location(file, `<${name} id="${id}"`, 0), name },
        ]);
      }
      const direct = await readSourceTrace(page.locator("#memo-direct"));
      expect(direct.source?.name).toBe("button");
      expect(direct.stack.some((frame) => frame.name === "DirectMemo")).toBe(
        true,
      );
      expect(direct.stack.some((frame) => frame.name === "MemoCounter")).toBe(
        false,
      );
      for (const [index, host] of hosts.entries()) {
        expect(await host.evaluate((node) => node.isConnected)).toBe(true);
        expect(await host.textContent()).toBe("1");
        expect(await host.getAttribute("data-renders")).toBe(renders[index]);
        await host.dispose();
      }
      await page.locator("#flip-provenance").click();
      for (const [id, name] of [
        ["memo-retained", "MemoCounter"],
        ["memo-compared", "ComparedCounter"],
      ] as const) {
        const trace = await readSourceTrace(page.locator(`#${id}`));
        expect(trace.stack.filter((frame) => frame.name === name)).toEqual([
          { ...location(file, `<${name} id="${id}"`, 1), name },
        ]);
      }
    });

    test("unmounted hosts lose traces and annotations even when reattached outside React", async ({
      page,
    }) => {
      const removed = await page.locator("#memo-retained").elementHandle();
      if (!removed) throw new Error("Missing memoized host.");
      await readSourceTrace(page.locator("#memo-retained"));
      await page.evaluate(() => window.renderProvenanceProbe(true));
      const probe = page.locator("#provenance-probe");
      await expect(probe).toHaveText("Traced probe");
      await expect
        .poll(() =>
          removed.evaluate(
            (node) =>
              Object.hasOwn(node, "__sourceTrace") ||
              node.hasAttribute("data-sourcetrace-stack"),
          ),
        )
        .toBe(false);
      expect(
        await removed.evaluate((node) => window.__SOURCETRACE__?.inspect(node)),
      ).toBeNull();
      await removed.dispose();
      expect((await readSourceTrace(probe)).coverage).toBe("exact");
      const host = await probe.elementHandle();
      if (!host) throw new Error("Missing provenance probe.");
      await page.evaluate(() => window.unmountProvenanceProbe());
      const empty = {
        trace: null,
        property: false,
        attributes: [],
      };
      for (const reattach of [false, true]) {
        expect(
          await host.evaluate((node, attach) => {
            if (attach) document.body.append(node);
            const trace = window.__SOURCETRACE__?.inspect(node);
            return {
              trace,
              property: Object.hasOwn(node, "__sourceTrace"),
              attributes: node
                .getAttributeNames()
                .filter((name) => name.startsWith("data-sourcetrace-")),
            };
          }, reattach),
        ).toEqual(empty);
      }
      expect((await readSourceTrace(page.locator("#first"))).source).toEqual({
        ...buttonSource,
        name: "button",
      });
      await host.evaluate((node) => node.remove());
      await host.dispose();
    });
  });
}
