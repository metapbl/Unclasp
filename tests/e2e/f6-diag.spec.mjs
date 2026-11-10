// F6 진단 모드 — v1.17.0 동작 고정 (특성 테스트, D022)
import { test, expect } from "./fixtures.mjs";

const KEY = "s:uc.test";
const WHY = "data-uc-why";
const BOX = `style="min-height:40px"`;

// 출처마다 하나씩 걸리는 페이지: 내 규칙, 기본 규칙, 예외, 텍스트, 접힘 예정
const SOURCES = {
  [KEY]: { selectors: ["#mine"], ex: [".keep"], texts: [{ scope: "div", word: "광고글" }] }
};
const SOURCES_BODY =
  `<div id="mine" ${BOX}>내 규칙</div>` +
  `<div class="ad-banner" id="base" ${BOX}>기본</div>` +
  `<div class="ad-banner keep" id="ex" ${BOX}>예외</div>` +
  `<div id="text" ${BOX}>광고글</div>` +
  `<div id="will" ${BOX}><div class="ad-banner">접힘 안의 배너</div></div>`;

// 테두리와 배지 색은 계산된 스타일로 읽는다
const look = (page, sel) => page.locator(sel).evaluate((el) => {
  const s = getComputedStyle(el), a = getComputedStyle(el, "::after");
  return { color: s.outlineColor, style: s.outlineStyle, badge: a.backgroundColor, why: el.getAttribute("data-uc-why") };
});

// 앞에 있는 탭의 id. tabs 권한이 없어 주소로는 찾지 못한다
const activeTabId = (worker) => worker.evaluate(async () =>
  (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].id);
const sessionDiag = (worker, id) => worker.evaluate(async (k) =>
  (await chrome.storage.session.get(k))[k], `diag:${id}`);

test.describe("F6 진단 모드", () => {
  test("출처별로 테두리 색·모양과 좌상단 배지가 하나씩 붙는다", async ({ open, store, diag }) => {
    await store.set(SOURCES);
    const page = await open(SOURCES_BODY);
    await expect(page.locator("#text")).toBeHidden();
    await diag(page, true);
    await expect(page.locator("#will")).toHaveAttribute(WHY, /접힘 예정/);

    expect(await look(page, "#mine")).toEqual({
      color: "rgb(45, 127, 249)", style: "dashed", badge: "rgb(45, 127, 249)", why: "내 규칙 · #mine" });
    expect(await look(page, "#base")).toMatchObject({
      color: "rgb(231, 76, 60)", style: "dashed", badge: "rgb(231, 76, 60)", why: expect.stringMatching(/^기본 규칙 · /) });
    expect(await look(page, "#ex")).toEqual({
      color: "rgb(39, 174, 96)", style: "solid", badge: "rgb(39, 174, 96)", why: "예외 유지 · .keep" });
    expect(await look(page, "#text")).toMatchObject({
      color: "rgb(230, 126, 34)", style: "dashed", badge: "rgb(230, 126, 34)" });
    expect(await look(page, "#will")).toEqual({
      color: "rgb(127, 140, 141)", style: "dotted", badge: "rgb(127, 140, 141)", why: "접힘 예정 · 숨긴 요소만 남음" });
    // 진단 중에는 숨기지 않는다
    await expect(page.locator("#base")).toBeVisible();
    await expect(page.locator("#text")).toBeVisible();
    // 배지는 요소의 좌상단에 붙는다
    expect(await page.locator("#mine").evaluate((el) => {
      const a = getComputedStyle(el, "::after");
      return [a.position, a.top, a.left, getComputedStyle(el).position];
    })).toEqual(["absolute", "0px", "0px", "relative"]);
  });

  test("한 요소에 출처가 여럿이면 내 규칙 하나만 남는다", async ({ open, store, diag }) => {
    await store.set({ [KEY]: { selectors: [".ad-banner"] } });
    const page = await open(`<div class="ad-banner" id="a" ${BOX}>둘 다</div>`);
    await diag(page, true);
    await expect(page.locator("#a")).toHaveAttribute(WHY, "내 규칙 · .ad-banner");
    await expect(page.locator("#a")).toHaveClass(/__uc_src_custom/);
    await expect(page.locator("#a")).not.toHaveClass(/__uc_src_base/);
  });

  test("팝업 범례 건수가 같은 출처를 센다", async ({ context, extensionId, worker, open, store, diag }) => {
    await store.set(SOURCES);
    const page = await open(SOURCES_BODY);
    await expect(page.locator("#text")).toBeHidden();
    await diag(page, true);
    await expect(page.locator("#will")).toHaveAttribute(WHY, /접힘 예정/);
    const id = await activeTabId(worker);

    // 팝업은 활성 탭을 읽는데, 탭으로 열면 팝업 자신이 활성 탭이다. 대상 탭을 직접 넣고 다시 센다
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.evaluate(async (t) => {
      // eslint-disable-next-line no-undef
      tabId = t; host = "uc.test"; await showCount();
    }, id);
    const n = (k) => popup.locator(`#lg-${k} .v`).textContent();
    await expect(popup.locator("#legend")).toBeVisible();
    // #will 안의 배너도 기본 규칙이라 기본 규칙은 2개
    expect({ custom: await n("custom"), base: await n("base"), ex: await n("ex"), text: await n("text"), will: await n("will") })
      .toEqual({ custom: "1개", base: "2개", ex: "1개", text: "1개", will: "1개" });
  });

  test("진단이 꺼져 있으면 팝업 범례를 감춘다", async ({ context, extensionId, worker, open }) => {
    const page = await open(`<div class="ad-banner">광고</div>`);
    await page.bringToFront();
    const id = await activeTabId(worker);
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    // eslint-disable-next-line no-undef
    await popup.evaluate(async (t) => { tabId = t; host = "uc.test"; await showCount(); }, id);
    await expect(popup.locator("#count")).toContainText("기본 규칙 1개");
    await expect(popup.locator("#legend")).toBeHidden();
  });

  test("탭 A 만 진단 ON 이면 탭 B 는 평소대로 숨긴다", async ({ open, diag }) => {
    const a = await open(`<div class="ad-banner" id="x">광고</div>`, "/a");
    const b = await open(`<div class="ad-banner" id="x">광고</div>`, "/b");
    await diag(a, true);
    await expect(a.locator("#x")).toHaveAttribute(WHY, /^기본 규칙/);
    await expect(a.locator("#x")).toBeVisible();
    await b.waitForTimeout(400);
    await expect(b.locator("#x")).toBeHidden();
    await expect(b.locator("#x")).not.toHaveAttribute(WHY, /./);
  });

  test("기본 규칙 1,000개와 내 규칙 5개: 배지는 400개 이하이고 내 규칙 5개는 모두 표시된다", async ({ open, store, diag }) => {
    await store.set({ [KEY]: { selectors: [".mine"] } });
    const page = await open(
      `<div class="ad-banner">광고</div>`.repeat(1000) + `<div class="mine">내 규칙</div>`.repeat(5));
    await diag(page, true);
    await expect(page.locator(".mine").last()).toHaveAttribute(WHY, /^내 규칙/);
    const c = await page.evaluate(() => ({
      marked: document.querySelectorAll("[data-uc-why]").length,
      custom: document.querySelectorAll(".mine.__uc_src_custom").length,
      base: document.querySelectorAll(".ad-banner.__uc_src_base").length
    }));
    expect(c).toEqual({ marked: 400, custom: 5, base: 395 });
  });

  test("진단을 끄면 테두리·배지가 사라지고 다시 숨긴다", async ({ open, diag }) => {
    const page = await open(`<div class="ad-banner" id="x">광고</div>`);
    await diag(page, true);
    await expect(page.locator("#x")).toHaveAttribute(WHY, /./);
    await diag(page, false);
    await expect(page.locator("#x")).toBeHidden();
    await expect(page.locator("#x")).not.toHaveAttribute(WHY, /./);
    await expect(page.locator("#x")).not.toHaveClass(/__uc_src_base/);
  });

  // 새 문서의 콘텐츠가 DOC_START 를 보내면 배경이 그 탭의 진단 상태를 지운다 (R§4 T15, D027).
  // 해시·pushState 는 문서가 그대로라 유지된다.
  test.describe("이동 시 해제", () => {
    async function diagOn(open, diag, worker) {
      const page = await open(`<div class="ad-banner" id="x">광고</div><a id="h" href="#k">해시</a>`, "/a");
      await diag(page, true);
      await expect(page.locator("#x")).toHaveAttribute(WHY, /./);
      return { page, id: await activeTabId(worker) };
    }
    // 팝업이 하는 것처럼 콘텐츠에 건수를 묻는다
    const count = (worker, id) => worker.evaluate((t) =>
      chrome.tabs.sendMessage(t, { type: "COUNT" }, { frameId: 0 }), id);

    test("새로고침하면 진단 상태가 지워져 팝업을 열어도 꺼져 있다", async ({ open, diag, worker }) => {
      const { page, id } = await diagOn(open, diag, worker);
      await page.reload();
      await expect.poll(() => sessionDiag(worker, id)).toBeUndefined();
      expect((await count(worker, id)).diagnose).toBe(false);
      await page.waitForTimeout(400);
      await expect(page.locator("#x")).toBeHidden();
      await expect(page.locator("#x")).not.toHaveAttribute(WHY, /./);
    });

    test("다른 주소로 이동해도 진단 상태가 지워진다", async ({ open, diag, worker, serve }) => {
      const { page, id } = await diagOn(open, diag, worker);
      await serve({ "/b": `<!doctype html><body><div class="ad-banner" id="x">광고</div>` });
      await page.goto("http://uc.test/b");
      await expect.poll(() => sessionDiag(worker, id)).toBeUndefined();
      expect((await count(worker, id)).diagnose).toBe(false);
      await expect(page.locator("#x")).toBeHidden();
    });

    // D033: 팝업을 연 채 새로 고치면 스위치·범례가 꺼짐으로 바뀐다
    test("팝업을 연 채 새로고침하면 팝업의 진단 스위치가 꺼지고 범례가 사라진다", async ({ context, extensionId, open, diag, worker }) => {
      const { page, id } = await diagOn(open, diag, worker);
      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${extensionId}/popup.html`);
      // eslint-disable-next-line no-undef
      await popup.evaluate(async (t) => { tabId = t; host = "uc.test"; await showCount(); }, id);
      await expect(popup.locator("#diag")).toBeChecked();
      await expect(popup.locator("#legend")).toBeVisible();
      await page.reload();
      await expect(popup.locator("#diag")).not.toBeChecked();
      await expect(popup.locator("#legend")).toBeHidden();
      await expect(popup.locator("#pick")).toBeDisabled();
    });

    test("꺼진 뒤 다시 켜면 새 문서에서도 진단이 켜진다", async ({ open, diag, worker }) => {
      const { page, id } = await diagOn(open, diag, worker);
      await page.reload();
      await expect.poll(() => sessionDiag(worker, id)).toBeUndefined();
      await diag(page, true);
      await expect(page.locator("#x")).toHaveAttribute(WHY, /^기본 규칙/);
    });

    test("해시 변경에서는 진단이 유지된다", async ({ open, diag, worker }) => {
      const { page, id } = await diagOn(open, diag, worker);
      await page.click("#h");
      await page.waitForTimeout(400);
      expect(await sessionDiag(worker, id)).toBe(true);
      await expect(page.locator("#x")).toHaveAttribute(WHY, /^기본 규칙/);
    });

    test("SPA 경로 변경(pushState)에서는 진단이 유지된다", async ({ open, diag, worker }) => {
      const { page, id } = await diagOn(open, diag, worker);
      await page.evaluate(() => history.pushState({}, "", "/spa"));
      await page.waitForTimeout(400);
      expect(await sessionDiag(worker, id)).toBe(true);
      await expect(page.locator("#x")).toHaveAttribute(WHY, /^기본 규칙/);
    });
  });

  test("확장을 새로 고치지 않았으면 팝업을 연 적 없는 탭에서도 Alt+Shift+X 로 진단이 켜진다", async ({ open, worker }) => {
    const page = await open(`<div class="ad-banner" id="x">광고</div>`);
    await page.bringToFront();
    // 단축키는 브라우저가 받으므로 배경의 처리 함수를 직접 부른다
    await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      // eslint-disable-next-line no-undef
      await cmdDiagnose(tab);
    });
    await expect(page.locator("#x")).toHaveAttribute(WHY, /./, { timeout: 2000 });
  });
  // 확장을 새로 고친 직후의 탭은 자동으로 시험하지 않는다. 다시 주입하려면 단축키가 주는 activeTab 이
  // 필요한데 Playwright 는 브라우저 단축키를 누를 수 없다 (R§4 T18). 실기기로 확인한다
});
