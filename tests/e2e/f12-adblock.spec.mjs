// F12 광고 차단 — 인수 테스트 (PRD F12, D080~D090)
import { test, expect } from "./fixtures.mjs";

const options = async (context, extensionId, hash = "") => {
  const p = await context.newPage();
  p.on("dialog", (d) => d.accept());
  await p.goto(`chrome-extension://${extensionId}/options.html${hash}`);
  await expect(p.locator("#quota")).not.toBeEmpty();
  return p;
};

test.describe("F12 광고 차단 저장 키와 스위치 자리", () => {
  // D085: 업데이트 전 저장소에는 adblock 키가 없다. 기본값 ON 을 따른다
  test("전역값에 adblock 이 없는 저장소에서 팝업·옵션의 광고 차단 전체 기본값이 ON 이다", async ({ context, extensionId, store }) => {
    await store.set({ global: { banner: true, rightclick: false, copy: false, back: true } });
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(popup.locator("#g-adblock")).toBeChecked();
    const p = await options(context, extensionId);
    await expect(p.locator('select[data-g="adblock"]')).toHaveValue("true");
  });

  // D089: 다섯 줄 중 맨 위
  test("팝업 스위치 다섯 줄 중 맨 위가 광고 차단이고, 옵션 표 첫 열이 광고다", async ({ context, extensionId, store }) => {
    await store.set({ "s:a.test": { banner: false } });
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(popup.locator("#rows .row")).toHaveCount(5);
    await expect(popup.locator("#rows .row .n").first()).toHaveText("광고 차단");
    const p = await options(context, extensionId, "#a.test");
    await expect(p.locator("#gbody td:first-child").first()).toHaveText("광고 차단");
    await expect(p.locator("#shead th").nth(1)).toHaveText("광고");
  });

  // R§4 T6: 빈 항목 판정·복구 화이트리스트에 새 키가 있어야 설정이 사라지지 않는다
  test("광고 차단만 OFF 인 사이트는 파일로 저장·초기화·복구 뒤에도 OFF 이고 설정 바꿈 점이 붙는다", async ({ context, extensionId, store }) => {
    await store.set({ "s:a.test": { adblock: false } });
    const p = await options(context, extensionId);
    await expect(p.locator('#siteNav a[data-host="a.test"] .p-set')).toBeAttached();
    await p.evaluate(() => {
      const click = HTMLAnchorElement.prototype.click;
      window.saved = new Promise((done) => {
        HTMLAnchorElement.prototype.click = function () {
          HTMLAnchorElement.prototype.click = click;
          fetch(this.href).then((r) => r.text()).then(done);
        };
      });
    });
    await p.click("#saveFile");
    const text = await p.evaluate(() => window.saved);
    await p.click("#reset");
    await expect.poll(async () => (await store.get())["s:a.test"]).toBeUndefined();
    await p.setInputFiles("#file", { name: "b.json", mimeType: "application/json", buffer: Buffer.from(text) });
    await expect.poll(async () => (await store.get())["s:a.test"]).toEqual({ adblock: false });
  });
});
