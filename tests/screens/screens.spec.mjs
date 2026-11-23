// README 스크린샷을 샘플 데이터로 생성한다 (D100~D104). 화면이 바뀌면 다시 돌린다: npm run screens
// 정지 PNG 4개(팝업·진단·선택기·옵션)와 빠른 시작 흐름 GIF 를 밝음·어둠으로 guide/images/ 에 쓴다.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, expect } from "../e2e/fixtures.mjs";

const OUT = path.resolve("guide/images");
const PAGE = { width: 960, height: 640 };
const hasFfmpeg = !spawnSync("ffmpeg", ["-version"]).error;

// 가상의 블로그 글. 실제 사이트·사람 이름은 쓰지 않는다 (README 표준 §4)
const ARTICLE = `
<style>
  :root { color-scheme: light dark; --bg: #fff; --ink: #1f2328; --muted: #59636e; --card: #f6f8fa; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0d1117; --ink: #e6edf3; --muted: #9198a1; --card: #161b22; } }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.6 system-ui, sans-serif; }
  header { padding: 14px 32px; border-bottom: 1px solid var(--card); font-weight: 700; }
  main { max-width: 640px; margin: 0 auto; padding: 8px 24px; }
  .top-banner { background: #d97706; color: #fff; padding: 14px 32px; font-weight: 600; }
  .sponsor-box { background: var(--card); padding: 16px; border-radius: 8px; color: var(--muted); }
  .newsletter { background: var(--card); padding: 16px; border-radius: 8px; border: 1px solid #8884; }
  p { color: var(--muted); }
</style>
<header>샘플 블로그</header>
<div class="top-banner">지금 가입하면 첫 달 무료! 앱 설치하고 혜택 받기</div>
<main>
  <h1>주말에 해 본 작은 실험</h1>
  <p>이 페이지는 스크린샷용 샘플입니다. 위의 띠 배너와 아래 상자들은 흔히 보이는 방해 요소를 흉내 냅니다.</p>
  <div class="sponsor-box">스폰서 콘텐츠 · 오늘만 특가</div>
  <p>본문이 이어집니다. 확장은 기본 규칙으로 배너를 숨기고, 남은 것은 골라 숨기기로 지웁니다.</p>
  <div class="newsletter" id="newsletter">뉴스레터를 구독하세요 <button>구독</button></div>
  <p>마지막 문단입니다.</p>
</main>`;

// 옵션 화면에 보일 샘플 사이트. 예약 도메인(example.*)만 쓴다
const SITES = {
  "s:news.example.com": { selectors: [".popup-layer", "#subscribe-modal"], rightclick: true },
  "s:shop.example.org": { selectors: [".promo-strip"], copy: true },
  "s:blog.example.net": { ex: [".keep-banner"], banner: false },
  "s:video.example.com": { adblock: false }
};

// 팝업은 활성 탭을 읽는데 탭으로 열면 자신이 활성 탭이다. 대상 탭을 넣고 다시 그린다 (f7-picker 와 같은 방식)
async function openPopup(context, extensionId, page, worker, scheme) {
  await page.bringToFront();
  const id = await worker.evaluate(async () =>
    (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].id);
  const popup = await context.newPage();
  await popup.emulateMedia({ colorScheme: scheme });
  await popup.setViewportSize({ width: 330, height: 640 });
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.evaluate(async (t) => {
    /* eslint-disable no-undef */
    tabId = t; host = "uc.test";
    document.getElementById("host").textContent = host;
    document.getElementById("reset").disabled = false;
    paint(await read());
    await showCount();
    /* eslint-enable no-undef */
  }, id);
  return popup;
}

const shotPopup = (popup) => popup.locator("body").screenshot({ animations: "disabled" });
async function shotPage(page) {
  await page.bringToFront();
  return page.screenshot({ animations: "disabled" });
}

// 흐름 장면: 페이지 위 오른쪽에 팝업을 얹는다. 합성도 브라우저에서 해 의존성을 더하지 않는다
async function compose(context, pageShot, popupShot) {
  if (!popupShot) return pageShot;
  const stage = await context.newPage();
  await stage.setViewportSize(PAGE);
  const src = (b) => `data:image/png;base64,${b.toString("base64")}`;
  await stage.setContent(`<body style="margin:0"><img src="${src(pageShot)}" style="display:block">
    <img src="${src(popupShot)}" style="position:absolute;top:0;right:24px;max-height:${PAGE.height - 16}px;
      border:1px solid #8886;border-top:0;border-radius:0 0 8px 8px;box-shadow:0 8px 24px #0006"></body>`);
  const shot = await stage.screenshot();
  await stage.close();
  return shot;
}

function makeGif(frames, file) {
  if (!hasFfmpeg) {
    console.log(`ffmpeg 없음: ${path.basename(file)} 를 건너뜀 (PNG 는 만듦)`);
    return;
  }
  const dir = mkdtempSync(path.join(os.tmpdir(), "uc-screens-"));
  frames.forEach((b, i) => writeFileSync(path.join(dir, `f${String(i).padStart(2, "0")}.png`), b));
  // 장면마다 1.8초, 끝없이 반복. 팔레트를 장면에서 뽑아 글자가 뭉개지지 않게 한다
  const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", "1/1.8", "-i", path.join(dir, "f%02d.png"),
    "-vf", "split[a][b];[a]palettegen=stats_mode=full[p];[b][p]paletteuse=dither=none", "-loop", "0", file]);
  if (r.status !== 0) throw new Error(`ffmpeg 실패: ${r.stderr}`);
}

for (const scheme of ["light", "dark"]) {
  test(`README 스크린샷 (${scheme})`, async ({ context, extensionId, worker, open, store, diag }) => {
    mkdirSync(OUT, { recursive: true });
    const save = (name, buf) => writeFileSync(path.join(OUT, `${name}-${scheme}.png`), buf);
    const frames = [];

    const page = await open(ARTICLE);
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize(PAGE);
    await page.waitForTimeout(400);
    await expect(page.locator(".top-banner")).toBeHidden();
    // 숨기기 전 모습을 보이려고 첫 장면은 배너 숨기기를 끈 채 찍는다
    await store.set({ "s:uc.test": { banner: false } });
    await page.reload();
    await expect(page.locator(".top-banner")).toBeVisible();
    frames.push(await shotPage(page));

    // 1. 배너 숨기기가 켜진 팝업과 페이지
    await store.set({ "s:uc.test": {} });
    await page.reload();
    await expect(page.locator(".top-banner")).toBeHidden();
    const popup = await openPopup(context, extensionId, page, worker, scheme);
    const popupShot = await shotPopup(popup);
    save("popup", popupShot);
    frames.push(await compose(context, await shotPage(page), popupShot));

    // 2. 팝업에서 진단을 켜면 숨긴 것이 점선과 배지로 보인다
    await popup.locator("label.sw:has(#diag)").click();
    await expect(page.locator(".top-banner")).toHaveAttribute("data-uc-why", /.+/);
    await page.waitForTimeout(400);
    const pageDiag = await shotPage(page);
    save("diag", pageDiag);
    frames.push(await compose(context, pageDiag, await shotPopup(popup)));

    // 3. 요소 선택: 팝업 스위치를 켜면 팝업이 닫히고 페이지를 조준한다
    await popup.locator("label.sw:has(#pick)").click().catch(() => {});
    await expect(page.locator("#__uc_pick")).toBeAttached();
    await page.bringToFront();
    const box = await page.locator("#newsletter").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.locator("#__uc_label")).toBeVisible();
    await page.waitForTimeout(200);
    const pagePick = await shotPage(page);
    save("picker", pagePick);
    frames.push(pagePick);

    // 4. 누르면 선택자가 저장된다
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.locator("#__uc_status")).toContainText("선택자 1건 추가");
    frames.push(await shotPage(page));

    // 5. 선택기를 끝내고 진단을 끄면 고른 상자도 숨는다
    await page.keyboard.press("Escape");
    await expect(page.locator("#__uc_pick")).not.toBeAttached();
    await diag(page, false);
    await expect(page.locator("#newsletter")).toBeHidden();
    await page.waitForTimeout(400);
    frames.push(await shotPage(page));

    makeGif(frames, path.join(OUT, `flow-${scheme}.gif`));

    // 옵션 페이지: 샘플 사이트 몇 곳
    await store.set(SITES);
    const opt = await context.newPage();
    await opt.emulateMedia({ colorScheme: scheme });
    await opt.setViewportSize({ width: 1100, height: 1000 });
    await opt.goto(`chrome-extension://${extensionId}/options.html#news.example.com`);
    await expect(opt.getByText("news.example.com").first()).toBeVisible();
    await opt.waitForTimeout(300);
    save("options", await opt.screenshot({ animations: "disabled" }));
  });
}
