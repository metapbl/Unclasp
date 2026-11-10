// F2 텍스트 규칙, F3 빈 컨테이너 접기 — Firefox ESR·토르 인수 테스트 (D040)
import { test } from "node:test";
import assert from "node:assert/strict";
import { suite, store, open, isHidden, isShown, hasClass, attr, diag, poll, text, Key, KEY, EXT_ORIGIN } from "./gecko.mjs";

// 텍스트 규칙은 가로 80px·세로 30px 이상인 요소만 잡는다
const BOX = `style="min-height:40px"`;
// 텍스트 적중·접힘 클래스는 흔적이라 평소에 붙이지 않는다 (D044). 계산된 값으로 본다
const display = (driver, css) => driver.executeScript("return getComputedStyle(document.querySelector(arguments[0])).display", css);
const height = (driver, css) => driver.executeScript("return document.querySelector(arguments[0]).getBoundingClientRect().height", css);

suite("F2 텍스트 규칙", (t) => {
  const rule = (texts) => store(t.driver).set({ [KEY]: { texts } });

  test("세 겹이 모두 낱말을 품으면 가장 안쪽 div 하나만 숨는다", async () => {
    await rule([{ scope: "div", word: "광고" }]);
    await open(t, `<div id="o" ${BOX}><div id="m" ${BOX}><div id="i" ${BOX}>광고</div></div></div>`);
    assert.equal(await isHidden(t.driver, "#i"), true);
    assert.equal(await display(t.driver, "#m"), "block");
    assert.equal(await display(t.driver, "#o"), "block");
  });

  test("제외 단어가 들어 있으면 낱말이 함께 있어도 숨기지 않는다", async () => {
    await rule([{ scope: "div", word: "광고", not: ["광고문의"] }]);
    await open(t, `<div id="x" ${BOX}>광고문의 02-123</div><div id="y" ${BOX}>광고</div>`);
    assert.equal(await isHidden(t.driver, "#y"), true);
    assert.equal(await isShown(t.driver, "#x"), true);
  });

  test("nav 안의 낱말은 잡지 않는다", async () => {
    await rule([{ scope: "div", word: "광고" }]);
    await open(t, `<nav><div id="n" ${BOX}>광고</div></nav><div id="y" ${BOX}>광고</div>`);
    assert.equal(await isHidden(t.driver, "#y"), true);
    assert.equal(await isShown(t.driver, "#n"), true);
  });

  test("완전 일치는 공백을 정리한 글자 전체가 낱말과 같을 때만 잡는다", async () => {
    await rule([{ scope: "div", word: "광고", m: "eq" }]);
    await open(t, `<div id="a" ${BOX}>  광고  </div><div id="b" ${BOX}>광고 문의</div>`);
    assert.equal(await isHidden(t.driver, "#a"), true);
    assert.equal(await isShown(t.driver, "#b"), true);
  });

  test("옵션의 텍스트 규칙 폼에 위험 정규식을 넣으면 오류를 알리고 입력칸에 포커스가 가며 저장되지 않는다 (D019)", async () => {
    await t.driver.get(`${EXT_ORIGIN}/options.html`);
    await (await t.driver.findElement({ css: "#tHost" })).sendKeys("127.0.0.1");
    await (await t.driver.findElement({ css: '#tMode option[value="re"]' })).click();
    await (await t.driver.findElement({ css: "#tWord" })).sendKeys("(a+)+$", Key.ENTER);
    assert.ok(await poll(async () => (await text(t.driver, "#msg"))?.includes("위험한 정규식")), await text(t.driver, "#msg"));
    assert.equal(await t.driver.executeScript("return document.getElementById('msg').classList.contains('err')"), true);
    assert.equal(await t.driver.executeScript("return document.activeElement.id"), "tWord");
    assert.deepEqual(await t.driver.executeAsyncScript("browser.storage.local.get(null).then(arguments[0])"), {});
  });
});

suite("F3 빈 컨테이너 접기", (t) => {
  test("자식이 숨긴 배너 하나뿐인 부모는 높이 0 으로 접힌다", async () => {
    await open(t, `<div id="p" style="padding:10px;border:1px solid #000;min-height:40px"><div class="ad-banner">광고</div></div><p>본문</p>`);
    assert.equal(await poll(async () => (await height(t.driver, "#p")) === 0), true);
  });

  test("부모가 자체 글자를 가지면 접히지 않는다", async () => {
    await open(t, `<div id="p">글자<div class="ad-banner">광고</div></div>`);
    assert.equal(await isHidden(t.driver, ".ad-banner"), true);
    assert.equal(await isShown(t.driver, "#p"), true);
    assert.ok(await height(t.driver, "#p") > 0);
  });

  test("진단 모드에서는 접지 않고 접힘 예정으로 표시만 한다", async () => {
    await open(t, `<div id="p" style="min-height:40px"><div class="ad-banner">광고</div></div>`);
    assert.equal(await poll(async () => (await height(t.driver, "#p")) === 0), true);
    await diag(t.driver, true);
    assert.equal(await poll(() => hasClass(t.driver, "#p", "__uc_will_collapse")), true);
    assert.ok(await height(t.driver, "#p") > 0);
    assert.match(await attr(t.driver, "#p", "data-uc-why"), /접힘 예정/);
  });
});
