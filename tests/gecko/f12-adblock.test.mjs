// F12 광고 차단 — Firefox ESR·토르 인수 테스트 (D040). 시험 서버가 127.0.0.1 하나라 사이트를 가리지 않는 IMA 표식으로 본다
import { test } from "node:test";
import assert from "node:assert/strict";
import { suite, open, ext, poll } from "./gecko.mjs";

// 15초짜리 무음 WAV. 재생 길이·감기가 실제 미디어처럼 동작한다
function silentWav(sec) {
  const rate = 8000, n = rate * sec, b = Buffer.alloc(44 + n, 128);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate, 28);
  b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write("data", 36); b.writeUInt32LE(n, 40);
  return "data:audio/wav;base64," + b.toString("base64");
}

suite("F12 광고 차단", (t) => {
  test("Google IMA 광고 video 가 끝까지 감기고 배지가 SKIP 이며, 넘긴 뒤 페이지에 흔적이 없다", async () => {
    await open(t, `<div id="ad-container"><video title="Advertisement"></video></div>`);
    // 소리 없는 재생은 자동 재생 정책에 막히지 않는다. 소리 되돌리기는 Chrome 테스트가 본다
    await t.driver.executeAsyncScript(`const [src, done] = arguments;
      const v = document.querySelector("video"); v.muted = true; v.src = src;
      v.play().then(() => done(), () => done());`, silentWav(15));
    assert.equal(await poll(() => t.driver.executeScript("return document.querySelector('video').ended")), true);
    assert.equal(await poll(async () => (await ext(t.driver, `(_, id) => browser.action.getBadgeText({ tabId: id })`)) === "SKIP"), true);
    // D013: 진단·선택기를 쓰지 않는 동안 확장이 넣은 요소·속성·<style> 이 없다 (F10 흔적 검사)
    assert.deepEqual(await t.driver.executeScript(`return [document.querySelector('[id^="__uc"], [class*="__uc"], [data-uc-why]'),
      document.querySelectorAll("style").length]`), [null, 0]);
  });

  // D105·D107·D111: 사이트별 표식이 없는 플레이어. 본 영상과 한 칸에 붙은 광고 틀의 스킵 단추 글자로 알아본다
  const layer = (btn) => `<div class="player"><video class="main"></video><div class="ad-layer">` +
    `<div class="ad-body"><video></video></div><button>${btn}</button></div></div>`;
  const play = (t) => t.driver.executeAsyncScript(`const [src, done] = arguments;
    const v = document.querySelector(".ad-body video"); v.muted = true; v.src = src;
    v.play().then(() => done(), () => done());`, silentWav(15));

  test('"5초 후 스킵" 단추가 있는 틀의 광고 video 가 끝까지 감기고 배지가 SKIP 이다', async () => {
    await open(t, layer("5초 후 스킵"));
    await play(t);
    assert.equal(await poll(() => t.driver.executeScript("return document.querySelector('.ad-body video').ended")), true);
    assert.equal(await poll(async () => (await ext(t.driver, `(_, id) => browser.action.getBadgeText({ tabId: id })`)) === "SKIP"), true);
  });

  test('"인트로 건너뛰기" 단추가 있는 틀의 video 는 건드리지 않는다', async () => {
    await open(t, layer("인트로 건너뛰기"));
    await play(t);
    await t.driver.sleep(1500);
    assert.deepEqual(await t.driver.executeScript(`const v = document.querySelector(".ad-body video");
      return [v.ended, v.currentTime < 5]`), [false, true]);
  });
});
