// F1 배너 숨기기 — v1.17.0 동작 고정 (특성 테스트, D022)
import { test, expect } from "./fixtures.mjs";

const KEY = "s:uc.test";

test.describe("F1 배너 숨기기", () => {
  test("기본 선택자에 걸린 div.ad-banner 가 숨는다", async ({ open }) => {
    const page = await open(`<div class="ad-banner" id="a">광고</div><p id="p">본문</p>`);
    await expect(page.locator("#a")).toBeHidden();
    await expect(page.locator("#p")).toBeVisible();
  });

  test("구조 가드: banner 클래스 div 가 입력칸을 품으면 보이고, 품지 않으면 숨는다", async ({ open }) => {
    const page = await open(
      `<div class="top-banner" id="g"><form><input type="search"></form></div>` +
      `<div class="top-banner" id="b"><a href="#">배너</a></div>` +
      `<div class="banner" id="r" role="banner">헤더</div>` +
      `<div class="banner" id="site-header">헤더</div>`);
    await expect(page.locator("#b")).toBeHidden();
    await expect(page.locator("#g")).toBeVisible();
    await expect(page.locator("#r")).toBeVisible();
    await expect(page.locator("#site-header")).toBeVisible();
  });

  test("광고 iframe 과 adsbygoogle 를 감싼 div 가 숨는다", async ({ open }) => {
    const page = await open(
      `<div id="w1"><ins class="adsbygoogle" id="i1"></ins></div>` +
      `<div id="w2"><iframe src="about:blank#doubleclick"></iframe></div>`);
    await expect(page.locator("#w1")).toBeHidden();
    // src 에 doubleclick 이 들어 있으면 iframe 과 감싼 div 가 함께 걸린다
    await expect(page.locator("#w2")).toBeHidden();
  });

  test("사이트 예외: 기본 규칙에 걸린 .keep 과 그 자손은 보이고, 직접 지정 선택자는 예외와 무관하게 숨는다", async ({ open, store }) => {
    await store.set({ [KEY]: { ex: [".keep"], selectors: ["#mine"] } });
    const page = await open(
      `<div class="ad-banner keep" id="k">예외</div>` +
      `<div class="keep"><div class="ad-banner" id="kd">자손</div></div>` +
      `<div class="ad-banner" id="o">다른 배너</div>` +
      `<div class="keep" id="mine">내 규칙</div>`);
    await expect(page.locator("#o")).toBeHidden();
    await expect(page.locator("#mine")).toBeHidden();
    await expect(page.locator("#k")).toBeVisible();
    await expect(page.locator("#kd")).toBeVisible();
  });

  test("기본규칙 끔: 기본 선택자 요소는 보이고 직접 지정 선택자 요소만 숨는다", async ({ open, store }) => {
    await store.set({ [KEY]: { nb: true, selectors: ["#mine"] } });
    const page = await open(`<div class="ad-banner" id="a">광고</div><div id="mine">내 규칙</div>`);
    await expect(page.locator("#mine")).toBeHidden();
    await expect(page.locator("#a")).toBeVisible();
  });

  test("배너 숨기기를 끄면 기본 선택자와 직접 지정 선택자 모두 보인다", async ({ open, store }) => {
    await store.set({ [KEY]: { banner: false, selectors: ["#mine"] } });
    const page = await open(`<div class="ad-banner" id="a">광고</div><div id="mine">내 규칙</div>`);
    // 설정을 읽을 시간을 준 뒤 확인한다
    await page.waitForTimeout(400);
    await expect(page.locator("#a")).toBeVisible();
    await expect(page.locator("#mine")).toBeVisible();
  });

  test("전역 배너 OFF 여도 사이트 덮어쓰기 ON 이면 숨는다", async ({ open, store }) => {
    await store.set({ global: { banner: false }, [KEY]: { banner: true } });
    const page = await open(`<div class="ad-banner" id="a">광고</div>`);
    await expect(page.locator("#a")).toBeHidden();
  });

  test("문법이 틀린 직접 지정 선택자는 무시되고 나머지는 적용된다", async ({ open, store }) => {
    await store.set({ [KEY]: { selectors: ["div[", "#mine"] } });
    const page = await open(`<div id="mine">내 규칙</div><div id="x">일반</div>`);
    await expect(page.locator("#mine")).toBeHidden();
    await expect(page.locator("#x")).toBeVisible();
  });

  test("나중에 추가된 배너도 숨는다", async ({ open }) => {
    const page = await open(`<p>본문</p>`);
    await page.evaluate(() => {
      const d = document.createElement("div");
      d.className = "ad-banner"; d.id = "late"; d.textContent = "늦은 광고";
      document.body.appendChild(d);
    });
    await expect(page.locator("#late")).toBeHidden();
  });

  test("저장된 설정이 바뀌면 열린 페이지에 바로 반영된다", async ({ open, store }) => {
    const page = await open(`<div id="mine">내 규칙</div>`);
    await expect(page.locator("#mine")).toBeVisible();
    await store.set({ [KEY]: { selectors: ["#mine"] } });
    await expect(page.locator("#mine")).toBeHidden();
  });
});
