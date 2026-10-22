import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { enableSourceTrace } from "../../src/playwright.js";

for (const storage of ["attributes", "property"] as const) {
  test(`build-disabled output cannot enable ${storage} tracing`, async ({
    page,
  }) => {
    await enableSourceTrace(page, { storage });
    await page.goto("./?sourcetrace=1");
    await expect(page.locator("#first")).toBeVisible();
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
  });
}

test("build-disabled JavaScript contains no tracing runtime or source metadata", ({
  baseURL,
}) => {
  expect(baseURL).toBeDefined();
  const variant = new URL(baseURL!).pathname.split("/")[1]!;
  const directory = path.join(process.cwd(), ".generated", variant, "assets");
  for (const name of readdirSync(directory).filter((file) =>
    file.endsWith(".js"),
  )) {
    const code = readFileSync(path.join(directory, name), "utf8");
    expect(code).not.toMatch(
      /__sourcetrace|__SOURCETRACE_|__sourceTrace|data-sourcetrace-stack|demo\/Button\.tsx/,
    );
  }
});
