// F7 요소 선택기 — v1.17.0 동작 고정 (특성 테스트, D022)
import { test, expect } from "./fixtures.mjs";

const KEY = "s:uc.test";
const WHY = "data-uc-why";

// 진단을 켜고 선택기를 연다. 팝업의 "요소 선택" 처럼 최상위 프레임에 PICK_START 를 보낸다
async function pick(page, diag, worker) {
  await diag(page, true);
  await page.waitForTimeout(300);
  const ok = await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return (await chrome.tabs.sendMessage(tab.id, { type: "PICK_START" }, { frameId: 0 })).ok;
  });
  expect(ok).toBe(true);
  await expect(page.locator("#__uc_pick")).toBeAttached();
}
const status = (page) => page.locator("#__uc_status");
const label = (page) => page.locator("#__uc_label");
const site = async (store) => (await store.get(KEY))[KEY];

test.describe("F7 요소 선택기", () => {
  test("클릭한 요소 하나에만 맞는 선택자가 저장되고 파란 테두리가 된다", async ({ open, store, diag, worker }) => {
    const page = await open(`<p class="x">하나</p><p class="x" id="t">둘</p><p class="x">셋</p>`);
    await pick(page, diag, worker);
    await page.click("#t");
    await expect(status(page)).toContainText("선택자 1건 추가");
    const { selectors } = await site(store);
    expect(selectors).toEqual(["#t"]);
    await expect(page.locator("#t")).toHaveClass(/__uc_src_custom/);
    expect(await page.locator("#t").evaluate((el) => getComputedStyle(el).outlineColor)).toBe("rgb(45, 127, 249)");
    // 숨기지 않는다. 진단 중이라 보인다
    await expect(page.locator("#t")).toBeVisible();
  });

  test("id 가 없으면 구조 선택자로 그 요소 하나만 집는다", async ({ open, store, diag, worker }) => {
    const page = await open(`<div><p class="x">하나</p><p class="x">둘</p><p class="x">셋</p></div>`);
    await pick(page, diag, worker);
    await page.locator("p").nth(1).click();
    await expect(status(page)).toContainText("선택자 1건 추가");
    const [sel] = (await site(store)).selectors;
    expect(await page.evaluate((s) => [...document.querySelectorAll(s)].map((e) => e.textContent), sel)).toEqual(["둘"]);
  });

  test("링크를 클릭해도 이동하지 않고 페이지의 클릭 처리도 돌지 않는다", async ({ open, diag, worker }) => {
    const page = await open(`<a id="l" href="/other" onclick="window.hit=1">링크</a>`);
    await pick(page, diag, worker);
    await page.click("#l");
    await expect(status(page)).toContainText("선택자 1건 추가");
    expect(page.url()).toBe("http://uc.test/");
    expect(await page.evaluate(() => window.hit)).toBeUndefined();
  });

  // D030: v1.17.0 은 click 만 막아 누르는 순간 이동하는 광고 링크가 동작했다
  test("누르는 순간(mousedown·pointerdown·mouseup) 동작하는 링크를 클릭해도 이동하지 않고 선택자가 저장된다", async ({ open, store, diag, worker, serve }) => {
    await serve({ "/next": "<p>next</p>" });
    const page = await open(
      `<a id="m" href="#" style="display:block;height:40px" onmousedown="location.href='/next'">mousedown</a>` +
      `<a id="p" href="#" style="display:block;height:40px" onpointerdown="window.hits=(window.hits||0)+1">pointerdown</a>` +
      `<a id="u" href="#" style="display:block;height:40px" onmouseup="window.hits=(window.hits||0)+1">mouseup</a>`);
    await pick(page, diag, worker);
    await page.click("#p");
    await page.click("#u");
    await page.click("#m");
    await expect(status(page)).toContainText("선택자 3건 추가");
    await page.waitForTimeout(300);
    expect(page.url()).toBe("http://uc.test/");
    expect(await page.evaluate(() => window.hits)).toBeUndefined();
    expect((await site(store)).selectors).toEqual(["#p", "#u", "#m"]);
  });

  test("선택기를 끝내면 누르기 처리가 다시 동작한다", async ({ open, diag, worker }) => {
    const page = await open(`<p id="t" onmousedown="window.hits=1">글</p>`);
    await pick(page, diag, worker);
    await page.keyboard.press("Escape");
    await page.click("#t");
    expect(await page.evaluate(() => window.hits)).toBe(1);
  });

  test("e 모드에서 링크를 조준하면 기본 규칙에 걸린 가장 가까운 조상 div 가 예외로 저장되고 초록 실선이 된다", async ({ open, store, diag, worker }) => {
    const page = await open(
      `<div class="ad-banner" id="outer"><div class="ad-banner" id="ad"><p><a id="l" href="#">링크</a></p></div></div>`);
    await pick(page, diag, worker);
    await page.keyboard.press("e");
    await page.hover("#l");
    await expect(label(page)).toContainText("부모로 올림");
    await page.click("#l");
    await expect(status(page)).toContainText("예외 추가(부모로 올림)");
    const { ex } = await site(store);
    expect(ex).toHaveLength(1);
    expect(await page.evaluate((s) => document.querySelector(s).id, ex[0])).toBe("ad");
    await expect(page.locator("#ad")).toHaveClass(/__uc_src_ex/);
    expect(await page.locator("#ad").evaluate((el) => {
      const s = getComputedStyle(el);
      return [s.outlineColor, s.outlineStyle];
    })).toEqual(["rgb(39, 174, 96)", "solid"]);
  });

  test("e 모드에서 기본 규칙에 걸린 조상이 없으면 저장하지 않는다", async ({ open, store, diag, worker }) => {
    const page = await open(`<p id="t">평범한 글</p>`);
    await pick(page, diag, worker);
    await page.keyboard.press("e");
    await page.click("#t");
    await expect(status(page)).toContainText("기본 규칙에 걸린 조상이 없습니다");
    expect(await site(store)).toBeUndefined();
  });

  test("두 개 등록 뒤 Ctrl+Z 두 번이면 둘 다 빠지고, 세 번째는 되돌릴 항목이 없다", async ({ open, store, diag, worker }) => {
    const page = await open(`<p id="a">가</p><p id="b">나</p>`);
    await pick(page, diag, worker);
    await page.click("#a");
    await expect(status(page)).toContainText("선택자 1건 추가");
    await page.click("#b");
    await expect(status(page)).toContainText("선택자 2건 추가");
    expect((await site(store)).selectors).toEqual(["#a", "#b"]);

    await page.keyboard.press("Control+z");
    await expect(status(page)).toHaveText("되돌렸습니다 · 선택자 1건");
    expect((await site(store)).selectors).toEqual(["#a"]);
    await page.keyboard.press("Control+z");
    await expect(status(page)).toHaveText("되돌렸습니다 · 선택자 0건");
    // 목록이 비면 사이트 항목 자체가 지워진다
    expect(await site(store)).toBeUndefined();
    await page.keyboard.press("Control+z");
    await expect(status(page)).toHaveText("되돌릴 항목이 없습니다");
  });

  test("이미 저장된 선택자를 다시 클릭하면 중복으로 넣지 않고, 되돌려도 규칙은 남는다", async ({ open, store, diag, worker }) => {
    await store.set({ [KEY]: { selectors: ["#a"] } });
    const page = await open(`<p id="a">가</p>`);
    await pick(page, diag, worker);
    await page.click("#a");
    await expect(status(page)).toContainText("이미 등록된 선택자입니다");
    await page.keyboard.press("Control+z");
    await expect(status(page)).toHaveText("되돌렸습니다 · 선택자 0건");
    expect((await site(store)).selectors).toEqual(["#a"]);
  });

  test("↑ 는 부모, ↓ 는 마우스가 집었던 쪽 자식으로 조준을 옮기고 Enter 로 등록한다", async ({ open, store, diag, worker }) => {
    const page = await open(`<div id="p"><span id="c">안쪽</span></div>`);
    await pick(page, diag, worker);
    await page.hover("#c");
    await expect(label(page)).toHaveText("#c");
    await page.keyboard.press("ArrowUp");
    await expect(label(page)).toHaveText("#p");
    await page.keyboard.press("ArrowUp");
    await expect(status(page)).toHaveText("더 위로 갈 수 없습니다");
    await page.keyboard.press("ArrowDown");
    await expect(label(page)).toHaveText("#c");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("Enter");
    await expect(status(page)).toContainText("선택자 1건 추가");
    expect((await site(store)).selectors).toEqual(["#p"]);
  });

  test.describe("덮개에 가린 요소", () => {
    const COVERED =
      `<div id="under" style="position:absolute;left:0;top:0;width:300px;height:100px">아래</div>` +
      `<div id="cover" style="position:fixed;left:0;top:0;width:300px;height:100px;background:rgba(0,0,0,.3)"></div>`;

    test("Tab 은 같은 자리에 겹친 요소를 돌고, Enter 는 고른 요소를 등록한다", async ({ open, store, diag, worker }) => {
      const page = await open(COVERED);
      await pick(page, diag, worker);
      await page.mouse.move(50, 50);
      await expect(label(page)).toHaveText("#cover");
      await page.keyboard.press("Tab");
      await expect(label(page)).toHaveText("#under");
      await expect(status(page)).toContainText("겹친 요소 2/2");
      await page.keyboard.press("Enter");
      await expect(status(page)).toContainText("선택자 1건 추가");
      expect((await site(store)).selectors).toEqual(["#under"]);
    });

    // D016: v1.17.0 은 클릭 직전의 마우스 이동이 조준을 덮개로 되돌려 덮개가 저장됐다
    test("Tab 으로 덮개 아래 요소를 고른 뒤 그 자리를 클릭하면 고른 요소가 저장된다", async ({ open, store, diag, worker }) => {
      const page = await open(COVERED);
      await pick(page, diag, worker);
      await page.mouse.move(50, 50);
      await page.keyboard.press("Tab");
      await expect(label(page)).toHaveText("#under");
      await page.mouse.click(50, 50);
      await expect(status(page)).toContainText("선택자 1건 추가");
      expect((await site(store)).selectors).toEqual(["#under"]);
    });

    // PRD F7 셋째: 덮개는 opacity 0.15 이하·pointer-events none, 풀면 원래 인라인 값
    test("고른 동안 덮개는 흐려지고 클릭을 통과시키며, 다른 요소를 고르거나 마우스를 크게 움직이거나 끝내면 원래 값으로 돌아간다", async ({ open, diag, worker }) => {
      const page = await open(COVERED.replace("background:", "opacity:0.9;background:"));
      const cover = (k) => page.locator("#cover").evaluate((el, p) => [getComputedStyle(el)[p], el.style[p]], k);
      const veiled = async () => {
        const [o] = await cover("opacity");
        return Number(o) <= 0.15 && (await cover("pointerEvents"))[0] === "none";
      };
      await pick(page, diag, worker);
      await page.mouse.move(50, 50);
      await page.keyboard.press("Tab");
      await expect.poll(veiled).toBe(true);
      // 다시 고르면(덮개로 돌아오면) 풀린다
      await page.keyboard.press("Tab");
      await expect(label(page)).toHaveText("#cover");
      expect(await cover("opacity")).toEqual(["0.9", "0.9"]);
      expect(await cover("pointerEvents")).toEqual(["auto", ""]);
      // 작게 움직이면 그대로, 크게 움직이면 풀린다
      await page.keyboard.press("Tab");
      await page.mouse.move(60, 60);
      await expect(label(page)).toHaveText("#under");
      expect(await veiled()).toBe(true);
      await page.mouse.move(150, 80);
      expect(await cover("opacity")).toEqual(["0.9", "0.9"]);
      // 끝내도 풀린다
      await page.mouse.move(50, 50);
      await page.keyboard.press("Tab");
      await expect.poll(veiled).toBe(true);
      await page.keyboard.press("Escape");
      expect(await cover("opacity")).toEqual(["0.9", "0.9"]);
      expect(await cover("pointerEvents")).toEqual(["auto", ""]);
    });
  });

  // D031: v1.17.0 은 iframe 위의 마우스가 iframe 안으로 가서 iframe 을 조준하지 못하고 안쪽 링크가 동작했다
  test.describe("iframe", () => {
    const AD = `<!doctype html><body style="margin:0"><a id="in" href="/next" target="_top" ` +
      `onclick="parent.postMessage('hit','*')" style="display:block;width:300px;height:100px">광고</a></body>`;
    const FRAME = `<iframe id="f" src="/ad" style="position:absolute;left:0;top:0;width:300px;height:100px;border:0"></iframe>`;

    test("iframe 안 링크 자리를 클릭하면 주소가 그대로이고 iframe 선택자가 저장된다", async ({ open, store, diag, worker, serve }) => {
      await serve({ "/ad": AD, "/next": "<p>next</p>" });
      const page = await open(FRAME + `<script>addEventListener("message", () => window.hit = 1)</script>`);
      await page.frameLocator("#f").locator("#in").waitFor();
      await pick(page, diag, worker);
      await page.mouse.move(50, 50);
      await expect(label(page)).toHaveText("#f");
      await page.mouse.click(50, 50);
      await expect(status(page)).toContainText("선택자 1건 추가");
      expect((await site(store)).selectors).toEqual(["#f"]);
      await page.waitForTimeout(300);
      expect(page.url()).toBe("http://uc.test/");
      expect(await page.evaluate(() => window.hit)).toBeUndefined();
    });

    test("가림막은 스크롤·새 iframe 을 따라가고, 선택기를 끝내면 사라진다", async ({ open, diag, worker, serve }) => {
      await serve({ "/ad": AD });
      const page = await open(`<div id="sp" style="height:3000px"></div>`);
      await pick(page, diag, worker);
      await page.evaluate((h) => document.body.insertAdjacentHTML("afterbegin", h),
        FRAME.replace('id="f"', 'id="g"').replace("top:0", "top:200px"));
      // 가림막은 다음 프레임에 놓인다
      await expect(page.locator("#__uc_pick .__uc_shield")).toHaveCount(1);
      await page.mouse.move(50, 250);
      await expect(label(page)).toHaveText("#g");
      await page.mouse.move(50, 120);
      await expect(label(page)).toHaveText("#sp");
      await page.mouse.wheel(0, 150);
      await page.waitForFunction(() => scrollY === 150);
      await page.mouse.move(50, 125);
      await expect(label(page)).toHaveText("#g");
      await page.keyboard.press("Escape");
      expect(await page.evaluate(() => document.elementFromPoint(50, 125).id)).toBe("g");
    });
  });

  test("ESC 로 끝내면 선택기 화면이 사라지고 클릭이 페이지로 간다", async ({ open, diag, worker }) => {
    const page = await open(`<p id="t" onclick="window.hit=1">글</p>`);
    await pick(page, diag, worker);
    await page.keyboard.press("Escape");
    await expect(page.locator("#__uc_pick")).not.toBeAttached();
    await page.click("#t");
    expect(await page.evaluate(() => window.hit)).toBe(1);
  });

  test("진단을 끄면 선택기도 끝난다", async ({ open, diag, worker }) => {
    const page = await open(`<p id="t">글</p>`);
    await pick(page, diag, worker);
    await diag(page, false);
    await expect(page.locator("#__uc_pick")).not.toBeAttached();
  });

  test("진단이 꺼져 있으면 선택기를 시작하지 않는다", async ({ open, worker }) => {
    const page = await open(`<p id="t">글</p>`);
    await page.bringToFront();
    await page.waitForTimeout(300);
    const ok = await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      return (await chrome.tabs.sendMessage(tab.id, { type: "PICK_START" }, { frameId: 0 })).ok;
    });
    expect(ok).toBe(false);
    await expect(page.locator("#__uc_pick")).not.toBeAttached();
    await expect(page.locator("#t")).not.toHaveAttribute(WHY, /./);
  });
});

// D032: 팝업의 요소 선택은 진단 아래 스위치. 진단일 때만 켤 수 있고, 다시 열면 켜짐을 보이며 끄면 끝난다
test.describe("팝업 요소 선택 토글 (D032)", () => {
  // 팝업은 활성 탭을 읽는데 탭으로 열면 팝업 자신이 활성 탭이다. 대상 탭을 넣고 다시 센다
  async function popupFor(context, extensionId, page, worker) {
    await page.bringToFront();
    const id = await worker.evaluate(async () =>
      (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].id);
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    // eslint-disable-next-line no-undef
    await popup.evaluate(async (t) => { tabId = t; host = "uc.test"; await showCount(); }, id);
    return popup;
  }
  const pickSw = (popup) => popup.getByRole("checkbox", { name: "골라 숨기기" });

  test("진단이 꺼져 있으면 요소 선택 스위치가 꺼진 채 잠긴다", async ({ context, extensionId, worker, open }) => {
    const page = await open(`<p id="t">글</p>`);
    const popup = await popupFor(context, extensionId, page, worker);
    await expect(pickSw(popup)).toBeDisabled();
    await expect(pickSw(popup)).not.toBeChecked();
  });

  test("진단을 켠 뒤 스위치를 켜면 페이지에서 선택기가 시작된다", async ({ context, extensionId, worker, open, diag }) => {
    const page = await open(`<p id="t">글</p>`);
    await diag(page, true);
    await page.waitForTimeout(300);
    const popup = await popupFor(context, extensionId, page, worker);
    await expect(pickSw(popup)).toBeEnabled();
    await popup.locator("label.sw:has(#pick)").click();
    await expect(page.locator("#__uc_pick")).toBeAttached();
  });

  test("선택기가 켜진 탭에서 팝업을 다시 열면 켜져 있고, 끄면 선택기가 끝난다", async ({ context, extensionId, worker, open, diag }) => {
    const page = await open(`<p id="t">글</p>`);
    await pick(page, diag, worker);
    const popup = await popupFor(context, extensionId, page, worker);
    await expect(pickSw(popup)).toBeChecked();
    await popup.locator("label.sw:has(#pick)").click();
    await expect(page.locator("#__uc_pick")).not.toBeAttached();
    await expect(pickSw(popup)).not.toBeChecked();
  });
});
