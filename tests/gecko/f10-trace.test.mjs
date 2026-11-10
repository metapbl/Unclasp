// F10 넷째 흔적 줄이기 — Firefox ESR·토르 인수 테스트 (D013, D044). 이쪽은 배경이 사용자 시트로 넣어
// adoptedStyleSheets 에도 남지 않는다
import { test } from "node:test";
import assert from "node:assert/strict";
import { suite, store, open, diag, attr, isHidden, poll, sleep, pageValue, KEY } from "./gecko.mjs";

const BOX = `style="min-height:40px"`;
const CONF = { [KEY]: { copy: true, selectors: ["#mine"], texts: [{ scope: "div", word: "협찬" }] } };
const BODY =
  `<div id="p" ${BOX}><div class="ad-banner">광고</div></div>` +
  `<div id="mine">내 규칙</div><div id="t" ${BOX}>협찬</div><p>본문</p>`;
const NONE = { marks: 0, styles: 0, sheets: 0, adopted: 0 };
const traces = (driver) => pageValue(driver, `{
  marks: w.document.querySelectorAll('[id^="__uc"], [class*="__uc"], [data-uc-why]').length,
  styles: w.document.querySelectorAll("style").length,
  sheets: w.document.styleSheets.length,
  adopted: w.document.adoptedStyleSheets.length }`);
const height = (driver, css) => driver.executeScript("return document.querySelector(arguments[0]).getBoundingClientRect().height", css);

suite("F10 흔적 줄이기", (t) => {
  async function hidden() {
    for (const css of [".ad-banner", "#mine", "#t"]) assert.equal(await isHidden(t.driver, css), true, css);
    assert.equal(await poll(async () => (await height(t.driver, "#p")) === 0), true);
  }

  test("평소 숨김은 페이지에 요소·클래스·속성·시트를 남기지 않는다", async () => {
    await store(t.driver).set(CONF);
    await open(t, BODY);
    await hidden();
    assert.deepEqual(await traces(t.driver), NONE);
  });

  test("진단을 켰다 끄면 진단의 흔적도 사라진다", async () => {
    await store(t.driver).set(CONF);
    await open(t, BODY);
    await hidden();
    await diag(t.driver, true);
    assert.match(await poll(() => attr(t.driver, "#t", "data-uc-why")) ?? "", /텍스트/);
    await diag(t.driver, false);
    await hidden();
    assert.deepEqual(await poll(async () => {
      const v = await traces(t.driver);
      return JSON.stringify(v) === JSON.stringify(NONE) && v;
    }) || await traces(t.driver), NONE);
  });

  test("앞에 요소가 끼어들어도 숨김이 원래 요소를 따라간다", async () => {
    await store(t.driver).set(CONF);
    await open(t, BODY);
    await hidden();
    await t.driver.executeScript(`const n = document.createElement("div");
      n.id = "new"; n.textContent = "새 글"; document.body.prepend(n);`);
    assert.equal(await poll(async () => (await height(t.driver, "#new")) > 0), true);
    // 끼어들기가 부른 다시 스캔 뒤에도 숨김이 남는다. 숨긴 요소는 크기가 0 이라 다시 재면 빠진다
    await sleep(700);
    await hidden();
  });
});
