// F7 요소 선택기 — Firefox ESR·토르 인수 테스트 (D040)
import { test } from "node:test";
import assert from "node:assert/strict";
import { suite, open, pick, popup, diag, site, press, poll, sleep, text, hasClass, pageValue, Key } from "./gecko.mjs";

suite("F7 요소 선택기", (t) => {
  const status = () => text(t.driver, "#__uc_status");
  const statusHas = (s) => poll(async () => (await status())?.includes(s));
  const click = async (css) => (await t.driver.findElement({ css })).click();
  const outline = (css) => t.driver.executeScript(
    "const s = getComputedStyle(document.querySelector(arguments[0])); return [s.outlineColor, s.outlineStyle]", css);

  test("클릭한 요소 하나에만 맞는 선택자가 저장되고 파란 테두리가 된다", async () => {
    await open(t, `<p class="x">하나</p><p class="x" id="t">둘</p><p class="x">셋</p>`);
    await pick(t.driver);
    await click("#t");
    assert.ok(await statusHas("선택자 1건 추가"), await status());
    assert.deepEqual((await site(t.driver)).selectors, ["#t"]);
    assert.equal(await hasClass(t.driver, "#t", "__uc_src_custom"), true);
    assert.equal((await outline("#t"))[0], "rgb(45, 127, 249)");
  });

  test("e 모드에서 링크를 조준하면 기본 규칙에 걸린 가장 가까운 조상 div 가 예외로 저장되고 초록 실선이 된다", async () => {
    await open(t, `<div class="ad-banner" id="outer"><div class="ad-banner" id="ad"><p><a id="l" href="#">링크</a></p></div></div>`);
    await pick(t.driver);
    await press(t.driver, "e");
    await t.driver.actions().move({ origin: await t.driver.findElement({ css: "#l" }) }).perform();
    await click("#l");
    assert.ok(await statusHas("예외 추가(부모로 올림)"), await status());
    const { ex } = await site(t.driver);
    assert.equal(ex.length, 1);
    assert.equal(await t.driver.executeScript("return document.querySelector(arguments[0]).id", ex[0]), "ad");
    assert.deepEqual(await outline("#ad"), ["rgb(39, 174, 96)", "solid"]);
  });

  test("두 개 등록 뒤 Ctrl+Z 두 번이면 둘 다 빠지고, 세 번째는 되돌릴 항목이 없다", async () => {
    await open(t, `<p id="a">가</p><p id="b">나</p>`);
    await pick(t.driver);
    await click("#a");
    assert.ok(await statusHas("선택자 1건 추가"));
    await click("#b");
    assert.ok(await statusHas("선택자 2건 추가"));
    assert.deepEqual((await site(t.driver)).selectors, ["#a", "#b"]);
    await press(t.driver, Key.CONTROL, "z");
    assert.ok(await statusHas("되돌렸습니다 · 선택자 1건"));
    await press(t.driver, Key.CONTROL, "z");
    assert.ok(await statusHas("되돌렸습니다 · 선택자 0건"));
    assert.equal(await site(t.driver), undefined);
    await press(t.driver, Key.CONTROL, "z");
    assert.ok(await statusHas("되돌릴 항목이 없습니다"), await status());
  });

  const COVERED =
    `<div id="under" style="position:absolute;left:0;top:0;width:300px;height:100px">아래</div>` +
    `<div id="cover" style="position:fixed;left:0;top:0;width:300px;height:100px;opacity:0.9;background:rgba(0,0,0,.3)"></div>`;
  const moveTo = (x, y) => t.driver.actions().move({ x, y }).perform();
  const cover = () => t.driver.executeScript(`const el = document.getElementById("cover"), s = getComputedStyle(el);
    return [Number(s.opacity), s.pointerEvents, el.style.opacity, el.style.pointerEvents]`);

  test("Tab 으로 덮개 아래 요소를 고른 뒤 그 자리를 클릭하면 고른 요소가 저장되고, 그동안 덮개는 흐려지고 클릭을 통과시킨다 (D016)", async () => {
    await open(t, COVERED);
    await pick(t.driver);
    await moveTo(50, 50);
    assert.equal(await poll(async () => (await text(t.driver, "#__uc_label")) === "#cover"), true);
    await press(t.driver, Key.TAB);
    assert.equal(await poll(async () => (await text(t.driver, "#__uc_label")) === "#under"), true);
    const [o, pe] = await cover();
    assert.ok(o <= 0.15 && pe === "none", JSON.stringify(await cover()));
    await t.driver.actions().move({ x: 50, y: 50 }).click().perform();
    assert.ok(await statusHas("선택자 1건 추가"), await status());
    assert.deepEqual((await site(t.driver)).selectors, ["#under"]);
  });

  test("다른 요소를 고르거나 마우스를 크게 움직이거나 선택기를 끝내면 덮개가 원래 값으로 돌아간다 (D016)", async () => {
    await open(t, COVERED);
    await pick(t.driver);
    await moveTo(50, 50);
    await press(t.driver, Key.TAB);
    await press(t.driver, Key.TAB);
    assert.equal(await poll(async () => (await text(t.driver, "#__uc_label")) === "#cover"), true);
    assert.deepEqual(await cover(), [0.9, "auto", "0.9", ""]);
    await press(t.driver, Key.TAB);
    await moveTo(150, 80);
    assert.deepEqual(await cover(), [0.9, "auto", "0.9", ""]);
    await moveTo(50, 50);
    await press(t.driver, Key.TAB);
    assert.equal((await cover())[1], "none");
    await press(t.driver, Key.ESCAPE);
    assert.deepEqual(await cover(), [0.9, "auto", "0.9", ""]);
  });

  test("iframe 안 링크 자리를 클릭하면 주소가 그대로이고 iframe 선택자가 저장된다 (D031)", async () => {
    t.server.serve({ "/next": "<p>next</p>", "/ad": `<!doctype html><body style="margin:0"><a id="in" href="/next" target="_top" ` +
      `style="display:block;width:300px;height:100px">광고</a></body>` });
    await open(t, `<iframe id="f" src="/ad" style="position:absolute;left:0;top:0;width:300px;height:100px;border:0"></iframe>`);
    await pick(t.driver);
    await moveTo(50, 50);
    assert.equal(await poll(async () => (await text(t.driver, "#__uc_label")) === "#f"), true, await text(t.driver, "#__uc_label"));
    await t.driver.actions().move({ x: 50, y: 50 }).click().perform();
    assert.ok(await statusHas("선택자 1건 추가"), await status());
    await sleep(300);
    assert.equal(await t.driver.getCurrentUrl(), t.server.origin + "/");
    assert.deepEqual((await site(t.driver)).selectors, ["#f"]);
  });

  test("누르는 순간(mousedown) 이동하는 링크를 클릭해도 주소가 그대로이고 선택자가 저장된다 (D030)", async () => {
    t.server.serve({ "/next": "<p>next</p>" });
    await open(t, `<a id="m" href="#" style="display:block;height:40px" onmousedown="location.href='/next'">mousedown</a>` +
      `<a id="p" href="#" style="display:block;height:40px" onpointerdown="window.hits=(window.hits||0)+1">pointerdown</a>`);
    await pick(t.driver);
    await click("#p");
    await click("#m");
    assert.ok(await statusHas("선택자 2건 추가"), await status());
    await sleep(300);
    assert.equal(await t.driver.getCurrentUrl(), t.server.origin + "/");
    assert.equal(await pageValue(t.driver, "w.hits"), null);
    assert.deepEqual((await site(t.driver)).selectors, ["#p", "#m"]);
  });
  // D032: 실제 팝업처럼 활성 탭을 읽는 팝업 탭으로 확인한다
  const pickState = () => t.driver.executeScript("const e = document.getElementById('pick'); return [e.type, e.checked, e.disabled]");
  const picking = () => t.driver.executeScript("return !!document.getElementById('__uc_pick')");

  test("팝업 요소 선택: 진단이 꺼져 있으면 꺼진 채 잠긴다 (D032)", async () => {
    await open(t, `<p id="t">글</p>`);
    await diag(t.driver, false);
    const back = await popup(t.driver);
    assert.deepEqual(await pickState(), ["checkbox", false, true]);
    await t.driver.close();
    await t.driver.switchTo().window(back);
  });

  test("팝업 요소 선택: 선택기가 켜진 탭에서 다시 열면 켜져 있고, 끄면 선택기가 끝난다 (D032)", async () => {
    await open(t, `<p id="t">글</p>`);
    await pick(t.driver);
    const back = await popup(t.driver);
    assert.deepEqual(await pickState(), ["checkbox", true, false]);
    await (await t.driver.findElement({ css: "label.sw:has(#pick)" })).click();
    assert.equal(await poll(async () => (await pickState())[1] === false), true);
    await t.driver.close();
    await t.driver.switchTo().window(back);
    assert.equal(await poll(async () => !(await picking())), true);
  });
});
