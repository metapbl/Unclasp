// F4 우클릭·복사 방지 해제, F5 백스페이스 뒤로가기 — v1.17.0 동작 고정 (특성 테스트, D022)
import { test, expect, ORIGIN } from "./fixtures.mjs";

const KEY = "s:uc.test";

// 페이지가 우클릭·선택·복사를 막고, 막았는지를 window.hits 에 기록한다
const BLOCKER = `
<p id="t" style="user-select:none" oncontextmenu="window.hits.inline++; return false">막힌 글자</p>
<script>
  window.hits = { menu: 0, select: 0, copy: 0, key: 0, inline: 0 };
  document.addEventListener("contextmenu", (e) => { window.hits.menu++; e.preventDefault(); });
  document.addEventListener("selectstart", (e) => { window.hits.select++; e.preventDefault(); });
  document.addEventListener("copy", (e) => { window.hits.copy++; e.preventDefault(); });
  document.addEventListener("keydown", (e) => { if (e.ctrlKey && e.key === "c") window.hits.key++; });
</script>`;

const hits = (page) => page.evaluate(() => window.hits);
// 설정이 반영된 뒤에 조작한다
const settle = (page) => page.waitForTimeout(400);

test.describe("F4 우클릭·복사 방지 해제", () => {
  test("우클릭 해제 ON 이면 페이지의 contextmenu 처리가 돌지 않는다", async ({ open, store }) => {
    await store.set({ [KEY]: { rightclick: true } });
    const page = await open(BLOCKER);
    await settle(page);
    await page.click("#t", { button: "right" });
    expect(await hits(page)).toMatchObject({ menu: 0, inline: 0 });
  });

  test("복사 해제 ON 이면 선택·복사·Ctrl+C 처리가 돌지 않고 user-select 가 text 가 된다", async ({ open, store }) => {
    await store.set({ [KEY]: { copy: true } });
    const page = await open(BLOCKER);
    await settle(page);
    await page.locator("#t").selectText();
    await page.keyboard.press("Control+c");
    await page.evaluate(() => document.dispatchEvent(new ClipboardEvent("copy", { bubbles: true })));
    expect(await hits(page)).toMatchObject({ select: 0, copy: 0, key: 0 });
    expect(await page.locator("#t").evaluate((el) => getComputedStyle(el).userSelect)).toBe("text");
  });

  test("두 기능 OFF(기본값)이면 페이지가 정한 대로 막힌다", async ({ open }) => {
    const page = await open(BLOCKER);
    await settle(page);
    await page.click("#t", { button: "right" });
    await page.locator("#t").dispatchEvent("selectstart");
    await page.keyboard.press("Control+c");
    const h = await hits(page);
    expect(h.menu).toBeGreaterThan(0);
    expect(h.inline).toBeGreaterThan(0);
    expect(h.select).toBeGreaterThan(0);
    expect(h.key).toBeGreaterThan(0);
    expect(await page.locator("#t").evaluate((el) => getComputedStyle(el).userSelect)).toBe("none");
  });
});

test.describe("F5 백스페이스 뒤로가기", () => {
  // /a → /b → /c 로 이동해 앞뒤 기록을 만든다. 마지막 페이지에서 시작한다.
  async function twoPages(context, serve, body = "") {
    const html = (n) => `<!doctype html><meta charset="utf-8"><title>${n}</title><body>${n}${body}</body>`;
    await serve({ "/a": html("a"), "/b": html("b"), "/c": html("c") });
    const page = await context.newPage();
    for (const p of ["/a", "/b", "/c"]) await page.goto(ORIGIN + p);
    await settle(page);
    return page;
  }

  // R§4 T14 (D026): 예전에는 한 번에 두 페이지씩 움직였다
  test("입력칸 밖에서 Backspace 는 이전 페이지, Shift+Backspace 는 다음 페이지로 한 칸씩", async ({ context, serve }) => {
    const page = await twoPages(context, serve);
    await page.keyboard.press("Backspace");
    await expect(page).toHaveURL(`${ORIGIN}/b`, { timeout: 2000 });
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(`${ORIGIN}/b`);
    await page.keyboard.press("Shift+Backspace");
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(`${ORIGIN}/c`);
  });

  test("텍스트 입력칸·textarea·contenteditable 에서는 글자만 지우고 이동하지 않는다", async ({ context, serve }) => {
    const page = await twoPages(context, serve,
      `<input id="i" value="ab"><textarea id="ta">ab</textarea><div id="ce" contenteditable>ab</div>`);
    for (const sel of ["#i", "#ta"]) {
      await page.locator(sel).focus();
      await page.locator(sel).press("End");
      await page.keyboard.press("Backspace");
      await expect(page.locator(sel)).toHaveValue("a");
    }
    await page.locator("#ce").focus();
    await page.keyboard.press("End");
    await page.keyboard.press("Backspace");
    await expect(page.locator("#ce")).toHaveText("a");
    await page.waitForTimeout(300);
    await expect(page).toHaveURL(`${ORIGIN}/c`);
  });

  test("체크박스에 포커스가 있으면 입력칸으로 보지 않아 이동한다", async ({ context, serve }) => {
    const page = await twoPages(context, serve, `<input id="c" type="checkbox">`);
    await page.locator("#c").focus();
    await page.keyboard.press("Backspace");
    await expect(page).toHaveURL(`${ORIGIN}/b`);
  });

  test("Ctrl·Alt 조합은 무시한다", async ({ context, serve }) => {
    const page = await twoPages(context, serve);
    await page.keyboard.press("Control+Backspace");
    await page.keyboard.press("Alt+Backspace");
    await page.waitForTimeout(300);
    await expect(page).toHaveURL(`${ORIGIN}/c`);
  });

  test("OFF 이면 Backspace 로 주소가 바뀌지 않는다", async ({ context, serve, store }) => {
    await store.set({ [KEY]: { back: false } });
    const page = await twoPages(context, serve);
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(300);
    await expect(page).toHaveURL(`${ORIGIN}/c`);
  });
});
