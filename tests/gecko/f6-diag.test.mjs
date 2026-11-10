// F6 진단 모드 — Firefox ESR·토르 인수 테스트 (D040).
// 확장을 새로 고친 직후의 Alt+Shift+X 는 단축키라 실기기로 확인한다
import { test } from "node:test";
import assert from "node:assert/strict";
import { suite, store, open, diag, popup, attr, isHidden, isShown, poll, text, KEY } from "./gecko.mjs";

const BOX = `style="min-height:40px"`;
// 출처마다 하나씩 걸리는 페이지: 내 규칙, 기본 규칙, 예외, 텍스트, 접힘 예정
const SOURCES = { [KEY]: { selectors: ["#mine"], ex: [".keep"], texts: [{ scope: "div", word: "광고글" }] } };
const SOURCES_BODY =
  `<div id="mine" ${BOX}>내 규칙</div>` +
  `<div class="ad-banner" id="base" ${BOX}>기본</div>` +
  `<div class="ad-banner keep" id="ex" ${BOX}>예외</div>` +
  `<div id="text" ${BOX}>광고글</div>` +
  `<div id="will" ${BOX}><div class="ad-banner">접힘 안의 배너</div></div>`;

// 테두리와 배지 색은 계산된 스타일로 읽는다
const look = (driver, css) => driver.executeScript(`const el = document.querySelector(arguments[0]);
  const s = getComputedStyle(el), a = getComputedStyle(el, "::after");
  return { color: s.outlineColor, style: s.outlineStyle, badge: a.backgroundColor };`, css);

suite("F6 진단 모드", (t) => {
  async function sources() {
    await store(t.driver).set(SOURCES);
    await open(t, SOURCES_BODY);
    assert.equal(await isHidden(t.driver, "#text"), true);
    await diag(t.driver, true);
    assert.match(await poll(() => attr(t.driver, "#will", "data-uc-why")) ?? "", /접힘 예정/);
  }

  test("요소마다 출처 하나의 테두리와 배지가 붙고 숨기지 않는다", async () => {
    await sources();
    assert.deepEqual(await look(t.driver, "#mine"), { color: "rgb(45, 127, 249)", style: "dashed", badge: "rgb(45, 127, 249)" });
    assert.deepEqual(await look(t.driver, "#base"), { color: "rgb(231, 76, 60)", style: "dashed", badge: "rgb(231, 76, 60)" });
    assert.deepEqual(await look(t.driver, "#ex"), { color: "rgb(39, 174, 96)", style: "solid", badge: "rgb(39, 174, 96)" });
    assert.deepEqual(await look(t.driver, "#text"), { color: "rgb(230, 126, 34)", style: "dashed", badge: "rgb(230, 126, 34)" });
    assert.deepEqual(await look(t.driver, "#will"), { color: "rgb(127, 140, 141)", style: "dotted", badge: "rgb(127, 140, 141)" });
    assert.equal(await attr(t.driver, "#mine", "data-uc-why"), "내 규칙 · #mine");
    assert.equal(await isShown(t.driver, "#base", 0), true);
  });

  test("팝업 범례 건수가 같은 출처를 센다", async () => {
    await sources();
    const back = await popup(t.driver);
    const n = (k) => text(t.driver, `#lg-${k} .v`);
    await poll(async () => (await n("custom")) !== "-");
    // #will 안의 배너도 기본 규칙이라 기본 규칙은 2개
    assert.deepEqual({ custom: await n("custom"), base: await n("base"), ex: await n("ex"), text: await n("text"), will: await n("will") },
      { custom: "1개", base: "2개", ex: "1개", text: "1개", will: "1개" });
    await t.driver.switchTo().window(back);
  });

  test("탭 A 만 진단 ON 이면 탭 B 는 평소대로 숨긴다", async () => {
    await open(t, `<div class="ad-banner" id="x">광고</div>`, "/a");
    await diag(t.driver, true);
    assert.match(await poll(() => attr(t.driver, "#x", "data-uc-why")) ?? "", /^기본 규칙/);
    await t.driver.switchTo().newWindow("tab");
    await open(t, `<div class="ad-banner" id="x">광고</div>`, "/b");
    assert.equal(await isHidden(t.driver, "#x"), true);
    assert.equal(await attr(t.driver, "#x", "data-uc-why"), null);
  });

  test("기본 규칙 1,000개와 내 규칙 5개: 배지는 400개 이하이고 내 규칙 5개는 모두 표시된다", async () => {
    await store(t.driver).set({ [KEY]: { selectors: [".mine"] } });
    await open(t, `<div class="ad-banner">광고</div>`.repeat(1000) + `<div class="mine">내 규칙</div>`.repeat(5));
    await diag(t.driver, true);
    const c = await poll(async () => {
      const r = await t.driver.executeScript(`return {
        marked: document.querySelectorAll("[data-uc-why]").length,
        custom: document.querySelectorAll(".mine.__uc_src_custom").length,
        base: document.querySelectorAll(".ad-banner.__uc_src_base").length }`);
      return r.custom === 5 && r;
    });
    assert.deepEqual(c, { marked: 400, custom: 5, base: 395 });
  });

  test("새로고침하면 진단이 꺼지고 팝업을 열어도 꺼져 있다", async () => {
    await open(t, `<div class="ad-banner" id="x">광고</div>`);
    await diag(t.driver, true);
    assert.ok(await poll(() => attr(t.driver, "#x", "data-uc-why")));
    await t.driver.navigate().refresh();
    assert.equal(await isHidden(t.driver, "#x"), true);
    const back = await popup(t.driver);
    assert.equal(await text(t.driver, "#host"), "127.0.0.1");
    assert.equal(await t.driver.executeScript("return document.getElementById('diag').checked"), false);
    await t.driver.switchTo().window(back);
    assert.equal(await isHidden(t.driver, "#x", 0), true);
    assert.equal(await attr(t.driver, "#x", "data-uc-why"), null);
  });
  test("팝업을 연 채 새로고침하면 팝업의 진단 스위치가 꺼지고 범례가 사라진다 (D033)", async () => {
    await open(t, `<div class="ad-banner" id="x">광고</div>`);
    await diag(t.driver, true);
    assert.ok(await poll(() => attr(t.driver, "#x", "data-uc-why")));
    const back = await popup(t.driver);
    const shown = () => t.driver.executeScript(
      "return [document.getElementById('diag').checked, getComputedStyle(document.getElementById('legend')).display]");
    assert.deepEqual(await poll(async () => (await shown())[0] && await shown()), [true, "block"]);
    const pop = await t.driver.getWindowHandle();
    await t.driver.switchTo().window(back);
    await t.driver.navigate().refresh();
    await t.driver.switchTo().window(pop);
    assert.deepEqual(await poll(async () => !(await shown())[0] && await shown()), [false, "none"]);
    await t.driver.close();
    await t.driver.switchTo().window(back);
  });
});
