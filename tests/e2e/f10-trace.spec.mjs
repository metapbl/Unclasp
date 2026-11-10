// F10 넷째 흔적 줄이기 — 진단·선택기를 쓰지 않는 동안 페이지가 확장의 흔적을 찾지 못한다 (D013, D044)
import { test, expect } from "./fixtures.mjs";

const KEY = "s:uc.test";
const BOX = `style="min-height:40px"`;
// 기본 규칙·내 규칙·텍스트 규칙·접기·복사 허용이 모두 걸리는 페이지
const CONF = { [KEY]: { copy: true, selectors: ["#mine"], texts: [{ scope: "div", word: "협찬" }] } };
const BODY =
  `<div id="p" ${BOX}><div class="ad-banner">광고</div></div>` +
  `<div id="mine">내 규칙</div><div id="t" ${BOX}>협찬</div><p>본문</p>`;
const height = (page, sel) => page.locator(sel).evaluate((el) => el.getBoundingClientRect().height);
// 페이지 스크립트가 찾을 수 있는 흔적
const traces = (page) => page.evaluate(() => ({
  marks: document.querySelectorAll('[id^="__uc"], [class*="__uc"], [data-uc-why]').length,
  styles: document.querySelectorAll("style").length,
  sheets: document.styleSheets.length
}));
const NONE = { marks: 0, styles: 0, sheets: 0 };

async function hidden(page) {
  await expect(page.locator(".ad-banner")).toBeHidden();
  await expect(page.locator("#mine")).toBeHidden();
  await expect(page.locator("#t")).toBeHidden();
  await expect.poll(() => height(page, "#p")).toBe(0);
}

test.describe("F10 흔적 줄이기", () => {
  test("평소 숨김은 페이지에 요소·클래스·속성·<style> 을 남기지 않는다", async ({ open, store }) => {
    await store.set(CONF);
    const page = await open(BODY);
    await hidden(page);
    expect(await traces(page)).toEqual(NONE);
  });

  test("진단을 켰다 끄면 진단의 흔적도 사라진다", async ({ open, store, diag }) => {
    await store.set(CONF);
    const page = await open(BODY);
    await hidden(page);
    await diag(page, true);
    await expect(page.locator("#t")).toHaveAttribute("data-uc-why", /텍스트/);
    await diag(page, false);
    await hidden(page);
    await expect.poll(() => traces(page)).toEqual(NONE);
  });

  test("앞에 요소가 끼어들어도 숨김이 원래 요소를 따라간다", async ({ open, store }) => {
    await store.set(CONF);
    const page = await open(BODY);
    await hidden(page);
    await page.evaluate(() => {
      const n = document.createElement("div");
      n.id = "new";
      n.textContent = "새 글";
      document.body.prepend(n);
    });
    await expect(page.locator("#new")).toBeVisible();
    await expect(page.locator("#t")).toBeHidden();
    await expect.poll(() => height(page, "#p")).toBe(0);
    // 끼어들기가 부른 다시 스캔 뒤에도 숨김이 남는다. 숨긴 요소는 크기가 0 이라 다시 재면 빠진다
    await page.waitForTimeout(700);
    await hidden(page);
  });

  test("페이지가 adoptedStyleSheets 를 다시 대입해도 숨김이 돌아온다", async ({ open, store }) => {
    await store.set(CONF);
    const page = await open(BODY);
    await hidden(page);
    await page.evaluate(() => {
      document.adoptedStyleSheets = [];
      document.body.append(document.createElement("i"));
    });
    await hidden(page);
  });
});
