// F1 배너 숨기기 — Firefox ESR·토르 인수 테스트 (D040)
import { test } from "node:test";
import assert from "node:assert/strict";
import { suite, store, open, isHidden, isShown, KEY } from "./gecko.mjs";

suite("F1 배너 숨기기", (t) => {
  test("배너 숨기기 ON 이면 div.ad-banner 가 보이지 않는다", async () => {
    await open(t, `<div class="ad-banner" id="a">광고</div><p id="p">본문</p>`);
    assert.equal(await isHidden(t.driver, "#a"), true);
    assert.equal(await isShown(t.driver, "#p", 0), true);
  });

  test("구조 가드: banner 클래스 div 가 검색 입력칸을 품으면 보인다", async () => {
    await open(t, `<div class="top-banner" id="g"><form><input type="search"></form></div>` +
      `<div class="top-banner" id="b"><a href="#">배너</a></div>`);
    assert.equal(await isHidden(t.driver, "#b"), true);
    assert.equal(await isShown(t.driver, "#g"), true);
  });

  test("사이트 예외: 기본 규칙에 걸린 .keep 과 그 자손은 보이고, 직접 지정 선택자는 예외와 무관하게 숨는다", async () => {
    await store(t.driver).set({ [KEY]: { ex: [".keep"], selectors: ["#mine"] } });
    await open(t, `<div class="ad-banner keep" id="k">예외</div>` +
      `<div class="keep"><div class="ad-banner" id="kd">자손</div></div>` +
      `<div class="ad-banner" id="o">다른 배너</div>` +
      `<div class="keep" id="mine">내 규칙</div>`);
    assert.equal(await isHidden(t.driver, "#o"), true);
    assert.equal(await isHidden(t.driver, "#mine"), true);
    assert.equal(await isShown(t.driver, "#k"), true);
    assert.equal(await isShown(t.driver, "#kd", 0), true);
  });

  test("기본규칙 끔이면 기본 선택자 요소는 보이고 직접 지정 선택자 요소만 숨는다", async () => {
    await store(t.driver).set({ [KEY]: { nb: true, selectors: ["#mine"] } });
    await open(t, `<div class="ad-banner" id="a">광고</div><div id="mine">내 규칙</div>`);
    assert.equal(await isHidden(t.driver, "#mine"), true);
    assert.equal(await isShown(t.driver, "#a", 0), true);
  });
});
