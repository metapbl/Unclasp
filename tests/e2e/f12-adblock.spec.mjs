// F12 광고 차단 — 인수 테스트 (PRD F12, D080~D090)
import { test, expect } from "./fixtures.mjs";

const options = async (context, extensionId, hash = "") => {
  const p = await context.newPage();
  p.on("dialog", (d) => d.accept());
  await p.goto(`chrome-extension://${extensionId}/options.html${hash}`);
  await expect(p.locator("#quota")).not.toBeEmpty();
  return p;
};

test.describe("F12 광고 차단 저장 키와 스위치 자리", () => {
  // D085: 업데이트 전 저장소에는 adblock 키가 없다. 기본값 ON 을 따른다
  test("전역값에 adblock 이 없는 저장소에서 팝업·옵션의 광고 차단 전체 기본값이 ON 이다", async ({ context, extensionId, store }) => {
    await store.set({ global: { banner: true, rightclick: false, copy: false, back: true } });
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(popup.locator("#g-adblock")).toBeChecked();
    const p = await options(context, extensionId);
    await expect(p.locator('select[data-g="adblock"]')).toHaveValue("true");
  });

  // D089: 다섯 줄 중 맨 위
  test("팝업 스위치 다섯 줄 중 맨 위가 광고 차단이고, 옵션 표 첫 열이 광고다", async ({ context, extensionId, store }) => {
    await store.set({ "s:a.test": { banner: false } });
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(popup.locator("#rows .row")).toHaveCount(5);
    await expect(popup.locator("#rows .row .n").first()).toHaveText("광고 차단");
    const p = await options(context, extensionId, "#a.test");
    await expect(p.locator("#gbody td:first-child").first()).toHaveText("광고 차단");
    await expect(p.locator("#shead th").nth(1)).toHaveText("광고");
  });

  // R§4 T6: 빈 항목 판정·복구 화이트리스트에 새 키가 있어야 설정이 사라지지 않는다
  test("광고 차단만 OFF 인 사이트는 파일로 저장·초기화·복구 뒤에도 OFF 이고 설정 바꿈 점이 붙는다", async ({ context, extensionId, store }) => {
    await store.set({ "s:a.test": { adblock: false } });
    const p = await options(context, extensionId);
    await expect(p.locator('#siteNav a[data-host="a.test"] .p-set')).toBeAttached();
    await p.evaluate(() => {
      const click = HTMLAnchorElement.prototype.click;
      window.saved = new Promise((done) => {
        HTMLAnchorElement.prototype.click = function () {
          HTMLAnchorElement.prototype.click = click;
          fetch(this.href).then((r) => r.text()).then(done);
        };
      });
    });
    await p.click("#saveFile");
    const text = await p.evaluate(() => window.saved);
    await p.click("#reset");
    await expect.poll(async () => (await store.get())["s:a.test"]).toBeUndefined();
    await p.setInputFiles("#file", { name: "b.json", mimeType: "application/json", buffer: Buffer.from(text) });
    await expect.poll(async () => (await store.get())["s:a.test"]).toEqual({ adblock: false });
  });
});

// 광고 video 로 쓸 15초짜리 무음 WAV. 외부에 접속하지 않고 재생 길이·감기가 실제 미디어처럼 동작한다
function silentWav(sec) {
  const rate = 8000, n = rate * sec, b = Buffer.alloc(44 + n, 128);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate, 28);
  b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write("data", 36); b.writeUInt32LE(n, 40);
  return "data:audio/wav;base64," + b.toString("base64");
}
const AD = silentWav(15);

// 실제 사이트 주소를 흉내 낸 시험 페이지. 요청은 여기서 응답해 밖으로 나가지 않는다
async function sitePage(context, origin, body) {
  await context.route(`${origin}/**`, (r) => r.fulfill({ contentType: "text/html; charset=utf-8",
    body: `<!doctype html><meta charset="utf-8"><title>t</title><body>${body}</body>` }));
  const page = await context.newPage();
  await page.goto(origin + "/");
  await page.click("body");   // 소리 있는 재생을 허용받는다
  return page;
}
// 광고를 튼다. setup(v) 은 페이지 안에서 표식을 붙이고, 광고가 끝났을 때 사이트가 하는 일을 흉내 낸다
const playAd = (page, css, setup) => page.evaluate(async ([src, sel, fn]) => {
  const v = document.querySelector(sel);
  v.src = src;
  new Function("v", fn)(v);
  await v.play();
}, [AD, css, setup]);
const video = (page, css) => page.evaluate((sel) => {
  const v = document.querySelector(sel);
  return v && { muted: v.muted, ended: v.ended, t: v.currentTime, opacity: getComputedStyle(v).opacity };
}, css);
const badge = (page, worker) => page.bringToFront().then(() => worker.evaluate(async () => {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return chrome.action.getBadgeText({ tabId: tab.id });
}));

test.describe("F12 영상 광고 넘기기", () => {
  test("YouTube: 플레이어에 ad-showing 이 붙은 광고는 끝까지 감기고 소리 상태가 돌아오며 배지가 SKIP 이다", async ({ context, worker }) => {
    const page = await sitePage(context, "https://www.youtube.com",
      `<div id="movie_player" class="html5-video-player"><video></video></div>`);
    await playAd(page, "video", `const mp = document.getElementById("movie_player");
      v.addEventListener("ended", () => mp.classList.remove("ad-showing"));
      mp.classList.add("ad-showing");`);
    await expect.poll(() => video(page, "video").then((x) => x.ended)).toBe(true);
    await expect.poll(() => video(page, "video"), { timeout: 3000 }).toMatchObject({ muted: false, opacity: "1" });
    await expect.poll(() => badge(page, worker)).toBe("SKIP");
  });

  for (const [name, origin, body, sel] of [
    ["SOOP 생방송", "https://play.sooplive.com", `<div id="videoLayer"><video id="da_video"></video></div>`, "#da_video"],
    ["SOOP 다시보기", "https://vod.sooplive.com", `<video id="adVideo"></video>`, "#adVideo"],
    ["치지직 생방송", "https://chzzk.naver.com", `<div id="preAdVideoContainer"><div><video></video></div></div>`, "#preAdVideoContainer video"],
    ["치지직 다시보기", "https://chzzk.naver.com", `<div class="webplayer-internal-core-ad-ui"><div><video></video></div></div>`, ".webplayer-internal-core-ad-ui video"]
  ]) test(`${name}: 광고 전용 video 가 끝까지 감기고 배지가 SKIP 이다`, async ({ context, worker }) => {
    const page = await sitePage(context, origin, body);
    await playAd(page, sel, `v.addEventListener("ended", () => v.remove());`);   // 사이트: 광고가 끝나면 광고 칸을 치운다
    await expect(page.locator(sel)).toHaveCount(0);
    await expect.poll(() => badge(page, worker)).toBe("SKIP");
  });

  test("Google IMA: title=Advertisement 광고 video 는 어느 사이트에서나 끝까지 감기고, 넘긴 뒤 페이지에 흔적이 없다", async ({ open, worker }) => {
    const page = await open(`<div id="ad-container"><video title="Advertisement"></video></div>`);
    await page.click("body");
    await playAd(page, "video", "");
    await expect.poll(() => video(page, "video").then((x) => x.ended)).toBe(true);
    await expect.poll(() => badge(page, worker)).toBe("SKIP");
    // D013: 진단·선택기를 쓰지 않는 동안 확장이 넣은 요소·속성·<style> 이 없다 (F10 흔적 검사)
    expect(await page.evaluate(() => [document.querySelector('[id^="__uc"], [class*="__uc"], [data-uc-why]'),
      document.querySelectorAll("style").length])).toEqual([null, 0]);
  });

  // D087: 감기가 막히면 1초 뒤 음소거·가림을 풀고 광고를 그대로 둔다
  test("감기가 안 먹는 광고는 그동안 소리가 꺼지고 가려졌다가 1초 뒤 풀린다", async ({ open }) => {
    const page = await open(`<video title="Advertisement"></video>`);
    await page.click("body");
    await playAd(page, "video", `v.addEventListener("seeking", () => { if (v.currentTime > 1) v.currentTime = 0.2; });`);
    await expect.poll(() => video(page, "video")).toMatchObject({ muted: true, opacity: "0" });
    await expect.poll(() => video(page, "video"), { timeout: 3000 }).toMatchObject({ muted: false, opacity: "1", ended: false });
    expect((await video(page, "video")).t).toBeLessThan(5);
  });

  for (const [name, body, stored] of [
    ["이 사이트 광고 차단 OFF 면 광고 video 를 건드리지 않는다", `<video title="Advertisement"></video>`, { "s:uc.test": { adblock: false } }],
    ["표식이 없는 일반 video 는 건드리지 않는다", `<video></video>`, {}],
    ["다른 사이트의 표식(치지직 광고 칸)은 이 사이트에서 쓰지 않는다", `<div id="preAdVideoContainer"><video></video></div>`, {}]
  ]) test(name, async ({ open, store }) => {
    await store.set(stored);
    const page = await open(body);
    await page.click("body");
    await playAd(page, "video", "");
    await page.waitForTimeout(1500);
    const v = await video(page, "video");
    expect(v).toMatchObject({ muted: false, ended: false, opacity: "1" });
    expect(v.t).toBeLessThan(5);
  });
});

// D084: 관찰한 사이트별 화면 광고 선택자 (AD_RESEARCH §7)
const SCREEN = [
  ["YouTube", "https://www.youtube.com", `<div id="player-ads">광고</div><ytd-in-feed-ad-layout-renderer>광고</ytd-in-feed-ad-layout-renderer>`,
    ["#player-ads", "ytd-in-feed-ad-layout-renderer"]],
  ["SOOP", "https://play.sooplive.com", `<div id="chat_ad">광고</div>`, ["#chat_ad"]],
  ["치지직", "https://chzzk.naver.com", `<div id="live_rs_banner">광고</div><div id="live_end_banner">광고</div><div id="vod_end_banner">광고</div>`,
    ["#live_rs_banner", "#live_end_banner", "#vod_end_banner"]]
];

test.describe("F12 화면 광고", () => {
  for (const [name, origin, ads, sels] of SCREEN) test(`${name}: 화면 광고 선택자에 맞는 요소가 숨고 본문은 보인다`, async ({ context }) => {
    const page = await sitePage(context, origin, `${ads}<p id="p">본문</p>`);
    for (const s of sels) await expect(page.locator(s)).toBeHidden();
    await expect(page.locator("#p")).toBeVisible();
  });

  test("이 사이트 광고 차단 OFF 면 화면 광고가 보인다", async ({ context, store }) => {
    await store.set({ "s:www.youtube.com": { adblock: false } });
    const page = await sitePage(context, "https://www.youtube.com", `<div id="player-ads">광고</div>`);
    await page.waitForTimeout(500);
    await expect(page.locator("#player-ads")).toBeVisible();
  });

  test("다른 사이트의 화면 광고 선택자는 이 사이트에서 쓰지 않는다", async ({ open }) => {
    const page = await open(`<div id="player-ads">본문 상자</div><div id="chat_ad">채팅</div>`);
    await page.waitForTimeout(500);
    await expect(page.locator("#player-ads")).toBeVisible();
    await expect(page.locator("#chat_ad")).toBeVisible();
  });

  // D086: 진단 모드에서는 숨기지 않고 기본 규칙과 같은 빨간 점선과 배지로 표시만 한다
  test("진단 모드에서는 화면 광고가 숨지 않고 빨간 점선과 '광고 차단' 배지로 보인다", async ({ context, diag }) => {
    const page = await sitePage(context, "https://chzzk.naver.com", `<div id="live_rs_banner" style="height:50px">광고</div><p>본문</p>`);
    await diag(page, true);
    const ad = page.locator("#live_rs_banner");
    await expect(ad).toBeVisible();
    await expect(ad).toHaveCSS("outline-style", "dashed");
    await expect(ad).toHaveCSS("outline-color", "rgb(231, 76, 60)");
    await expect(ad).toHaveAttribute("data-uc-why", /^광고 차단 · /);
  });
});
