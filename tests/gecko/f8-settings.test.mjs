// F8 설정 — Firefox ESR·토르 인수 테스트 (D040). 단축키는 실기기로 확인한다
import { test } from "node:test";
import assert from "node:assert/strict";
import { suite, store, ext, site, open, popup, pick, install, dialog, poll, sleep, text, isShown, EXT_ORIGIN, KEY } from "./gecko.mjs";

suite("F8 설정", (t) => {
  // 스위치 입력은 감춰져 있어 감싼 label 을 누른다
  const sw = async (id) => (await t.driver.findElement({ css: `label.sw:has(#${id})` })).click();
  const ov = (k) => text(t.driver, `#ov-${k}`);

  test("기본값 따름에서 이 사이트 스위치를 끄면 이 사이트만 OFF 가 되고 ● 가 붙는다", async () => {
    await open(t, `<div class="ad-banner" id="a">광고</div>`);
    const back = await popup(t.driver);
    assert.equal(await text(t.driver, "#host"), "127.0.0.1");
    assert.equal(await ov("banner"), "");
    await sw("s-banner");
    assert.equal(await poll(async () => (await ov("banner")) === "●"), true);
    await t.driver.switchTo().window(back);
    assert.deepEqual(await site(t.driver), { banner: false });
    assert.equal((await store(t.driver).get("global")).global, undefined);
    assert.equal(await isShown(t.driver, "#a"), true);
  });

  test("OFF 에서 다시 켜면 전역값과 같아져 ● 가 사라지고 기본값 따름이 된다 (D028)", async () => {
    await store(t.driver).set({ [KEY]: { banner: false } });
    await open(t, `<p>글</p>`);
    const back = await popup(t.driver);
    await sw("s-banner");
    assert.equal(await poll(async () => (await ov("banner")) === ""), true);
    await t.driver.switchTo().window(back);
    assert.equal(await site(t.driver), undefined);
  });

  test("옵션 페이지를 연 채 다른 탭의 선택기로 규칙을 추가하고 옵션에서 다른 사이트를 고쳐도 둘 다 남는다", async () => {
    await store(t.driver).set({ "s:other.test": { banner: false } });
    await open(t, `<p id="t">글</p>`);
    const page = await t.driver.getWindowHandle();
    await t.driver.switchTo().newWindow("tab");
    await t.driver.get(`${EXT_ORIGIN}/options.html#other.test`);
    const optionsTab = await t.driver.getWindowHandle();
    const copy = 'select[data-host="other.test"][data-key="copy"]';
    await poll(async () => (await t.driver.findElements({ css: copy })).length);

    await t.driver.switchTo().window(page);
    await pick(t.driver);
    await (await t.driver.findElement({ css: "#t" })).click();
    assert.deepEqual(await poll(async () => (await site(t.driver))?.selectors), ["#t"]);

    await t.driver.switchTo().window(optionsTab);
    // 옵션이 저장 변경으로 목록을 다시 그리는 사이 찾은 요소는 사라질 수 있어 다시 찾아 누른다
    assert.equal(await poll(async () => {
      try { await (await t.driver.findElement({ css: `${copy} option[value="true"]` })).click(); return true; } catch { return false; }
    }), true);
    await sleep(500);
    await t.driver.switchTo().window(page);
    const all = await store(t.driver).get();
    assert.deepEqual(all["s:other.test"], { banner: false, copy: true });
    assert.deepEqual(all[KEY], { selectors: ["#t"] });
  });

  // D052: 브라우저 단축키는 WebDriver 가 누르지 못해 팝업 탭에서 배경의 같은 처리를 부른다
  // 옮겨 온 팝업 탭이 활성 탭이라 대상은 주소로 찾는다
  const command = (cmd) => t.driver.executeAsyncScript(`const done = arguments[0];
    browser.tabs.query({}).then((tabs) => {
      const tab = tabs.find((x) => x.url.startsWith("http"));
      return browser.runtime.sendMessage({ type: "COMMAND", cmd: "${cmd}", tab: { id: tab.id, url: tab.url } });
    }).then(done);`);

  test("단축키 처리가 열린 팝업에 반영된다: 배너 스위치, 선택기 켜면 닫힘, 끄면 스위치 꺼짐", async () => {
    await open(t, `<p id="t">글</p>`);
    let back = await popup(t.driver);
    await command("toggle-banner");
    assert.equal(await poll(() => t.driver.executeScript(`return !document.getElementById("s-banner").checked`)), true);
    await t.driver.close();
    await t.driver.switchTo().window(back);

    back = await popup(t.driver);
    const tab = await t.driver.getWindowHandle();
    await command("start-picker");
    assert.equal(await poll(async () => !(await t.driver.getAllWindowHandles()).includes(tab)), true);
    await t.driver.switchTo().window(back);
    assert.equal(await poll(() => t.driver.executeScript(`return !!document.getElementById("__uc_pick")`)), true);

    back = await popup(t.driver);
    assert.equal(await t.driver.executeScript(`return document.getElementById("pick").checked`), true);
    await command("start-picker");
    assert.equal(await poll(() => t.driver.executeScript(`return !document.getElementById("pick").checked`)), true);
    await t.driver.close();
    await t.driver.switchTo().window(back);
    assert.equal(await poll(() => t.driver.executeScript(`return !document.getElementById("__uc_pick")`)), true);
  });

  test("전체 설정을 누르면 옵션 페이지가 열리고 팝업은 닫힌다 (D060)", async () => {
    await open(t, `<p id="t">글</p>`);
    const back = await popup(t.driver);
    const tab = await t.driver.getWindowHandle();
    await (await t.driver.findElement({ css: "#opts" })).click();
    assert.equal(await poll(async () => !(await t.driver.getAllWindowHandles()).includes(tab)), true);
    const handles = await t.driver.getAllWindowHandles();
    assert.equal(handles.length, 2);
    await t.driver.switchTo().window(handles.find((h) => h !== back));
    assert.equal(await poll(async () => (await t.driver.getCurrentUrl()).endsWith("options.html")), true);
    await t.driver.switchTo().window(back);
  });

  // D052: 이쪽은 팝업이 닫히지 않고 브라우저 단축키가 그대로 돈다. 팝업까지 처리하면 두 번 뒤집힌다
  test("팝업은 단축키를 막지 않는다", async () => {
    await t.driver.get(`${EXT_ORIGIN}/popup.html`);
    await poll(() => t.driver.executeScript("return document.querySelectorAll('#rows .row').length === 4"));
    await sleep(300);
    assert.equal(await t.driver.executeScript(`
      const e = new KeyboardEvent("keydown", { altKey: true, shiftKey: true, code: "KeyX", cancelable: true, bubbles: true });
      document.dispatchEvent(e);
      return e.defaultPrevented;`), false);
  });

  test("http·https 가 아닌 페이지에서는 사이트 스위치가 잠기고 저장 항목이 생기지 않는다", async () => {
    // 앞에 띄운 팝업은 자기 자신(moz-extension://)을 활성 탭으로 읽는다
    await t.driver.get(`${EXT_ORIGIN}/popup.html`);
    await poll(() => t.driver.executeScript("return document.querySelectorAll('#rows .row').length === 4"));
    assert.equal(await poll(async () => (await text(t.driver, "#host")) === "(적용할 수 없는 페이지)"), true);
    for (const k of ["banner", "rightclick", "copy", "back"])
      assert.equal(await poll(() => t.driver.executeScript(`return document.getElementById("s-${k}").disabled`)), true, k);
    await t.driver.executeScript("document.querySelector('label.sw:has(#s-banner)').click()");
    await sleep(200);
    assert.deepEqual(Object.keys(await store(t.driver).get()), []);
  });

  test("기존 storage.sync 에 설정이 있으면 새 버전 설치 때 local 로 복사하고 sync 는 지우지 않는다 (D021)", async () => {
    const OLD = { global: { banner: false, rightclick: true, copy: false, back: true }, schema: 2, [KEY]: { selectors: ["#mine"] } };
    await store(t.driver).sync.set(OLD);
    // 같은 id 로 다시 설치하면 업데이트라 onInstalled 가 돈다
    await install(t.driver);
    assert.deepEqual(await poll(async () => { const a = await store(t.driver).get(); return a.schema && a; }), OLD);
    assert.deepEqual(await store(t.driver).sync.get(), OLD);
    // 화면이 전과 같다: 옮겨 온 전역 배너 OFF 가 적용된다
    await open(t, `<div class="ad-banner" id="a">광고</div>`);
    assert.equal(await isShown(t.driver, "#a"), true);
  });

  test("local 에 설정이 이미 있으면 sync 에서 덮어쓰지 않는다", async () => {
    await store(t.driver).set({ "s:a.test": { copy: true } });
    await store(t.driver).sync.set({ global: { banner: false }, "s:a.test": { banner: false } });
    await install(t.driver);
    await sleep(500);
    const all = await store(t.driver).get();
    assert.deepEqual(all["s:a.test"], { copy: true });
    assert.equal(all.global, undefined);
  });

  test("요소 선택 키를 바꿔 둔 채 업데이트하면 manifest 값으로 돌아온다 (D049)", async () => {
    const keys = () => ext(t.driver, `async () => Object.fromEntries((await browser.commands.getAll()).map((c) => [c.name, c.shortcut]))`);
    await open(t, `<p>글</p>`);
    await ext(t.driver, `() => browser.commands.update({ name: "start-picker", shortcut: "Alt+Shift+S" })`);
    assert.equal((await keys())["start-picker"], "Alt+Shift+S");
    // 같은 id 로 다시 설치하면 업데이트라 onInstalled 가 돈다
    await install(t.driver);
    await open(t, `<p>글</p>`);
    assert.equal(await poll(async () => (await keys())["start-picker"] === "Alt+Shift+C"), true, JSON.stringify(await keys()));
    assert.deepEqual(await keys(), {
      _execute_action: "Alt+Shift+O", "start-picker": "Alt+Shift+C", "toggle-diagnose": "Alt+Shift+X", "toggle-banner": "Alt+Shift+Z" });
  });

  test("팝업 내가 숨긴 항목 ✕: 확인창에 대상이 나오고, 취소하면 그대로, 확인하면 지워진다 (D036)", async () => {
    await store(t.driver).set({ [KEY]: { selectors: ["#a", "#b"] } });
    await open(t, `<p id="a">가</p><p id="b">나</p>`);
    const back = await popup(t.driver);
    const x = async () => (await t.driver.findElement({ css: "#sels .x" })).click();
    await poll(async () => (await t.driver.findElements({ css: "#sels .x" })).length);
    await x();
    assert.equal(await dialog(t.driver, false), "127.0.0.1 의 선택자를 삭제할까요?\n\n#a");
    await sleep(300);
    await x();
    assert.equal(await dialog(t.driver, true), "127.0.0.1 의 선택자를 삭제할까요?\n\n#a");
    await sleep(500);
    await t.driver.switchTo().window(back);
    assert.deepEqual(await site(t.driver), { selectors: ["#b"] });
  });
  test("옵션: 모든 사이트에는 사이트별 줄이 없고, 사이트를 고르면 그 사이트 것만, 찾기는 선택자로 거른다 (D035, D075)", async () => {
    await store(t.driver).set({ "s:a.test": { selectors: [".ad-a1", ".ad-a2"] }, "s:b.test": { selectors: [".ad-b1"], ex: [".keep"] } });
    await t.driver.get(`${EXT_ORIGIN}/options.html`);
    const shown = () => t.driver.executeScript(`return [...document.querySelectorAll("button[data-sval]")]
      .filter((b) => b.checkVisibility()).map((b) => b.dataset.sval)`);
    const count = (css) => t.driver.executeScript(`return [...document.querySelectorAll(arguments[0])]
      .filter((e) => e.checkVisibility()).length`, css);
    assert.equal(await poll(async () => (await count(".hint")) === 3), true);
    assert.equal(await count("#sbody > tr[data-host], #selbox > div[data-host], #exbox > div[data-host]"), 0);
    await (await t.driver.findElement({ css: '#siteNav a[data-host="b.test"]' })).click();
    assert.deepEqual(await poll(async () => (await shown()).length === 1 && await shown()), [".ad-b1"]);
    assert.equal(await t.driver.executeScript("return document.getElementById('nHost').value"), "b.test");
    await (await t.driver.findElement({ css: "#siteNav a[data-all]" })).click();
    await (await t.driver.findElement({ css: "#find" })).sendKeys("a2");
    assert.deepEqual(await poll(async () => (await shown()).length === 1 && await shown()), [".ad-a2"]);
  });
});
