import { test, expect, ORIGIN } from "./fixtures.mjs";

test("확장이 올라가고 팝업이 열린다", async ({ context, extensionId, serve }) => {
  await serve({ "/": "<!doctype html><title>t</title><p>hello</p>" });
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/`);
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(popup.locator("#rows .row")).toHaveCount(4);
});
