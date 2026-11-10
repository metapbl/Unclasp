// F11 화면 — 재구성 전 지금 화면의 조작·다크 모드·접근성 고정 (특성 테스트, D022)
import { test, expect } from "./fixtures.mjs";

const FEATURES = ["배너 숨기기", "우클릭 방지 해제", "복사 방지 해제", "백스페이스 뒤로가기"];

// 배경의 상대 명도(0~1). body 가 투명하면 html, 둘 다 투명하면 흰 캔버스로 본다
const bgLuminance = (page) => page.evaluate(() => {
  const parse = (c) => c.match(/[\d.]+/g).map(Number);
  let rgba = [255, 255, 255, 1];
  for (const el of [document.body, document.documentElement]) {
    const v = parse(getComputedStyle(el).backgroundColor);
    if (v[3] !== 0) { rgba = v; break; }
  }
  const lin = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(rgba[0]) + 0.7152 * lin(rgba[1]) + 0.0722 * lin(rgba[2]);
});

// 글자색과 그 뒤 바탕색의 대비. 바탕은 자신부터 위로 올라가며 처음 칠해진 것 (D072)
const contrastOf = (loc) => loc.evaluate((el) => {
  const parse = (c) => c.match(/[\d.]+/g).map(Number);
  const lum = ([r, g, b]) => [r, g, b].map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; })
    .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  let bg = [255, 255, 255];
  for (let e = el; e; e = e.parentElement) {
    const v = parse(getComputedStyle(e).backgroundColor);
    if (v[3] !== 0) { bg = v; break; }
  }
  const [a, b] = [lum(parse(getComputedStyle(el).color)), lum(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
});

test.describe("F11 접근성 손질 (D072)", () => {
  test("밝은 테마: 범례 이름·강조색 글자·제외 단어 대비 4.5:1 이상", async ({ context, extensionId }) => {
    const popup = await context.newPage();
    await popup.emulateMedia({ colorScheme: "light" });
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.evaluate(() => {
      document.getElementById("legend").style.display = "block";
      document.getElementById("sels").innerHTML = `<div class="s"><span class="badge ok">숨김 1</span></div>`;
      document.getElementById("msg").textContent = "시험";
    });
    for (const sel of [".lg .t", ".badge.ok"])
      for (const el of await popup.locator(sel).all()) expect(await contrastOf(el), sel).toBeGreaterThanOrEqual(4.5);

    const p = await context.newPage();
    await p.emulateMedia({ colorScheme: "light" });
    await p.goto(`chrome-extension://${extensionId}/options.html`);
    await p.evaluate(() => {
      document.getElementById("textbox").innerHTML = `<div><ul class="sel"><li><span class="xword">광고문의</span></li></ul></div>`;
      document.getElementById("msg").textContent = "시험";
    });
    for (const sel of ["button.primary", ".xword", "#msg"])
      for (const el of await p.locator(sel).all()) expect(await contrastOf(el), sel).toBeGreaterThanOrEqual(4.5);
  });

  test("알림은 status 이고 팝업 숨긴 항목 ✕ 의 이름은 \"이 규칙 삭제\" 다", async ({ context, extensionId, worker, open, store }) => {
    await store.set({ "s:uc.test": { selectors: ["#a"] } });
    const page = await open(`<p id="a">가</p>`);
    await page.bringToFront();
    const id = await worker.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].id);
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    // eslint-disable-next-line no-undef
    await popup.evaluate(async (t) => { tabId = t; host = "uc.test"; await showCount(); }, id);
    await expect(popup.getByRole("button", { name: "이 규칙 삭제" })).toHaveCount(1);
    await expect(popup.locator("#msg")).toHaveAttribute("role", "status");

    const p = await context.newPage();
    await p.goto(`chrome-extension://${extensionId}/options.html`);
    await expect(p.locator("#msg")).toHaveAttribute("role", "status");
  });

  test("옵션 추가 입력칸은 키보드 포커스에 2px 외곽선이 보인다", async ({ context, extensionId }) => {
    const p = await context.newPage();
    await p.goto(`chrome-extension://${extensionId}/options.html`);
    // 글자 입력칸은 Chromium 에서 늘 :focus-visible 이다
    const el = p.locator("#sHost");
    await el.focus();
    const o = await el.evaluate((e) => { const s = getComputedStyle(e); return [s.outlineStyle, s.outlineWidth]; });
    expect(o).toEqual(["solid", "2px"]);
  });

  for (const scheme of ["light", "dark"])
    test(`${scheme}: 꺼진 스위치 바탕은 화면 바탕과 3:1 이상`, async ({ context, extensionId }) => {
      const popup = await context.newPage();
      await popup.emulateMedia({ colorScheme: scheme });
      await popup.goto(`chrome-extension://${extensionId}/popup.html`);
      const ratio = await popup.locator("#diag + .track").evaluate((t) => {
        const parse = (c) => c.match(/[\d.]+/g).map(Number);
        const lum = ([r, g, b]) => [r, g, b].map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; })
          .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
        const [a, b] = [lum(parse(getComputedStyle(t).backgroundColor)), lum(parse(getComputedStyle(document.body).backgroundColor))]
          .sort((x, y) => y - x);
        return (a + 0.05) / (b + 0.05);
      });
      expect(ratio).toBeGreaterThanOrEqual(3);
    });
});

test.describe("F11 화면", () => {
  test("팝업: 스위치 4×2·진단·골라 숨기기·초기화·전체 설정이 있다", async ({ context, extensionId }) => {
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(popup.locator("#rows .row")).toHaveCount(4);
    for (const k of ["banner", "rightclick", "copy", "back"]) {
      await expect(popup.locator(`#g-${k}`)).toHaveAttribute("type", "checkbox");
      await expect(popup.locator(`#s-${k}`)).toHaveAttribute("type", "checkbox");
    }
    await expect(popup.locator("#rows .row .n")).toHaveText(FEATURES);
    await expect(popup.locator("#diag")).toHaveAttribute("type", "checkbox");
    await expect(popup.getByRole("checkbox", { name: "골라 숨기기" })).toHaveAttribute("id", "pick");
    await expect(popup.locator("#reset")).toHaveText("사이트 초기화");
    await expect(popup.locator("#opts")).toHaveText("전체 설정");
  });

  test("옵션: 카드 7개와 각 기능의 조작이 있다", async ({ context, extensionId }) => {
    const p = await context.newPage();
    await p.goto(`chrome-extension://${extensionId}/options.html`);
    await expect(p.locator("section.card h2")).toHaveText([
      "전체 기본값", /^사이트 목록/, "내가 숨긴 항목", "기본 규칙 예외", "텍스트 규칙", "백업과 복구", "초기화"]);
    for (const id of ["#gbody", "#siteForm", "#selForm", "#exForm", "#textForm", "#tMode",
      "#saveFile", "#loadFile", "#clearSites", "#reset"]) await expect(p.locator(id)).toBeAttached();
    await expect(p.locator("#gbody select")).toHaveCount(4);
    await expect(p.locator("#gbody td:first-child")).toHaveText(FEATURES);
  });

  test("선택기: 안내줄에 조작키가 모두 적혀 있다", async ({ open, diag, worker }) => {
    const page = await open(`<div id="a" style="min-height:40px">a</div>`);
    await diag(page, true);
    await page.waitForTimeout(300);
    const ok = await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      return (await chrome.tabs.sendMessage(tab.id, { type: "PICK_START" }, { frameId: 0 })).ok;
    });
    expect(ok).toBe(true);
    const guide = page.locator("#__uc_guide");
    for (const key of ["클릭·Enter", "e 예외 모드", "↑↓ 부모·자식", "Tab 겹친 요소", "Ctrl+Z 되돌리기", "ESC 종료"])
      await expect(guide).toContainText(key);
  });

  test("옵션: OS 다크 모드면 배경 명도 20% 이하", async ({ context, extensionId }) => {
    const p = await context.newPage();
    await p.emulateMedia({ colorScheme: "dark" });
    await p.goto(`chrome-extension://${extensionId}/options.html`);
    expect(await bgLuminance(p)).toBeLessThanOrEqual(0.2);
  });

  test("팝업: OS 다크 모드면 배경 명도 20% 이하", async ({ context, extensionId }) => {
    const popup = await context.newPage();
    await popup.emulateMedia({ colorScheme: "dark" });
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    expect(await bgLuminance(popup)).toBeLessThanOrEqual(0.2);
  });

  test("팝업: 스위치마다 기능 이름과 checked 상태가 있다", async ({ context, extensionId }) => {
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(popup.locator("#rows .row")).toHaveCount(4);
    const role = /^(switch|checkbox)$/;
    for (const name of [...FEATURES, "진단 모드", "골라 숨기기"]) {
      const sw = popup.getByRole("switch", { name }).or(popup.getByRole("checkbox", { name }));
      await expect(sw).toHaveCount(FEATURES.includes(name) ? 2 : 1, { timeout: 1000 });
      for (const el of await sw.all())
        expect(await el.evaluate((e) => e.getAttribute("role") || e.type)).toMatch(role);
    }
  });
});
