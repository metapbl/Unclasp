// F4 우클릭·복사 방지 해제, F5 백스페이스 뒤로가기 — Firefox ESR·토르 인수 테스트 (D040)
import { test } from "node:test";
import assert from "node:assert/strict";
import { suite, store, open, press, pageValue, sleep, poll, Key, KEY } from "./gecko.mjs";

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

suite("F4 우클릭·복사 방지 해제", (t) => {
  const hits = () => pageValue(t.driver, "w.hits");
  const userSelect = () => t.driver.executeScript("return getComputedStyle(document.getElementById('t')).userSelect");
  const rightClick = async () => {
    await t.driver.actions().contextClick(await t.driver.findElement({ css: "#t" })).perform();
    await press(t.driver, Key.ESCAPE);
  };

  test("우클릭 해제 ON 이면 페이지의 contextmenu 처리가 돌지 않는다", async () => {
    await store(t.driver).set({ [KEY]: { rightclick: true } });
    await open(t, BLOCKER);
    await sleep(400);
    await rightClick();
    assert.deepEqual(await hits(), { menu: 0, select: 0, copy: 0, key: 0, inline: 0 });
  });

  test("복사 해제 ON 이면 선택·복사·Ctrl+C 처리가 돌지 않고 user-select 가 text 가 된다", async () => {
    await store(t.driver).set({ [KEY]: { copy: true } });
    await open(t, BLOCKER);
    await sleep(400);
    await t.driver.actions().doubleClick(await t.driver.findElement({ css: "#t" })).perform();
    await press(t.driver, Key.CONTROL, "c");
    await t.driver.executeScript("document.dispatchEvent(new ClipboardEvent('copy', { bubbles: true }))");
    assert.deepEqual(await hits(), { menu: 0, select: 0, copy: 0, key: 0, inline: 0 });
    assert.equal(await userSelect(), "text");
  });

  test("두 기능 OFF(기본값)이면 페이지가 정한 대로 막힌다", async () => {
    await open(t, BLOCKER);
    await sleep(400);
    await rightClick();
    await t.driver.executeScript("document.getElementById('t').dispatchEvent(new Event('selectstart', { bubbles: true }))");
    await press(t.driver, Key.CONTROL, "c");
    const h = await hits();
    assert.ok(h.menu > 0 && h.inline > 0 && h.select > 0 && h.key > 0, JSON.stringify(h));
    assert.equal(await userSelect(), "none");
  });
});

suite("F5 백스페이스 뒤로가기", (t) => {
  // /a → /b → /c 로 이동해 앞뒤 기록을 만든다. 마지막 페이지에서 시작한다
  async function threePages(body = "") {
    for (const n of ["a", "b", "c"]) await open(t, `${n}${body}`, `/${n}`);
    await sleep(400);
  }
  const at = (p) => poll(async () => (await t.driver.getCurrentUrl()) === t.server.origin + p, 2000);
  const stays = async (p) => { await sleep(500); return (await t.driver.getCurrentUrl()) === t.server.origin + p; };

  test("입력칸 밖에서 Backspace 는 이전 페이지로 간다", async () => {
    await threePages();
    await press(t.driver, Key.BACK_SPACE);
    assert.equal(await at("/b"), true);
    // 한 번에 한 칸만 움직인다 (D026)
    assert.equal(await stays("/b"), true);
  });

  test("Shift+Backspace 는 다음 페이지로 간다", async () => {
    await threePages();
    await press(t.driver, Key.BACK_SPACE);
    assert.equal(await at("/b"), true);
    await sleep(300);
    await press(t.driver, Key.SHIFT, Key.BACK_SPACE);
    assert.equal(await at("/c"), true);
  });

  test("텍스트 입력칸에서는 글자만 지우고 주소가 바뀌지 않는다", async () => {
    await threePages(`<input id="i" value="ab">`);
    const input = await t.driver.findElement({ css: "#i" });
    await input.click();
    await press(t.driver, Key.END);
    await press(t.driver, Key.BACK_SPACE);
    assert.equal(await input.getAttribute("value"), "a");
    assert.equal(await stays("/c"), true);
  });

  test("OFF 이면 Backspace 로 주소가 바뀌지 않는다", async () => {
    await store(t.driver).set({ [KEY]: { back: false } });
    await threePages();
    await press(t.driver, Key.BACK_SPACE);
    assert.equal(await stays("/c"), true);
  });
});
