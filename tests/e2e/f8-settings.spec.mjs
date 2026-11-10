// F8 설정·단축키 — v1.17.0 동작 고정 (특성 테스트, D022)
import { chromium } from "@playwright/test";
import path from "node:path";
import { test, expect } from "./fixtures.mjs";

const KEY = "s:uc.test";

// 팝업은 활성 탭을 읽는데, 탭으로 열면 팝업 자신이 활성 탭이다. 대상 탭을 직접 넣고 다시 그린다.
// 시작 코드가 붙인 이벤트 처리는 이 전역값을 그대로 쓴다.
async function popupFor(context, extensionId, page, worker) {
  await page.bringToFront();
  const id = await worker.evaluate(async () =>
    (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].id);
  const popup = await context.newPage();
  // --load-extension 으로 올리면 명령 키가 비어 있다. 실제처럼 manifest 의 키를 돌려준다 (D052)
  await popup.addInitScript(() => {
    chrome.commands.getAll = async () => Object.entries(chrome.runtime.getManifest().commands)
      .map(([name, c]) => ({ name, shortcut: c.suggested_key.default }));
  });
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(popup.locator("#rows .row")).toHaveCount(4);
  await popup.evaluate(async ([t, h]) => {
    /* eslint-disable no-undef */
    tabId = t; host = h;
    // 시작 코드가 호스트 없이 잠근 초기화 단추를 같은 기준으로 다시 정한다
    document.getElementById("reset").disabled = !host;
    paint(await read());
    await showCount();
    /* eslint-enable no-undef */
  }, [id, new URL(page.url()).hostname]);
  return popup;
}
// 스위치 입력은 감춰져 있어 감싼 label 을 누른다
const sw = (popup, id) => popup.locator(`label.sw:has(#${id})`);
const ov = (popup, k) => popup.locator(`#ov-${k}`);

// 단축키 처리 함수를 서비스 워커에서 직접 부른다. 단축키는 activeTab 을 주므로 tab.url 을 채운다
const runCmd = (worker, fn, url) => worker.evaluate(async ([f, u]) => {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  // eslint-disable-next-line no-undef
  await ({ cmdDiagnose, cmdPicker, cmdBanner })[f](u ? { ...tab, url: u } : tab);
  return chrome.action.getBadgeText({ tabId: tab.id });
}, [fn, url]);

test.describe("F8 팝업 사이트 설정 3상태", () => {
  test("기본값 따름에서 이 사이트 스위치를 끄면 이 사이트만 OFF 가 되고 ● 가 붙는다", async ({ context, extensionId, worker, open, store }) => {
    const page = await open(`<div class="ad-banner">광고</div>`);
    const popup = await popupFor(context, extensionId, page, worker);
    await expect(popup.locator("#g-banner")).toBeChecked();
    await expect(popup.locator("#s-banner")).toBeChecked();
    await expect(ov(popup, "banner")).toHaveText("");

    await sw(popup, "s-banner").click();
    await expect(ov(popup, "banner")).toHaveText("●");
    expect(await store.get()).toMatchObject({ [KEY]: { banner: false } });
    expect((await store.get()).global).toBeUndefined();
    await expect(page.locator(".ad-banner")).toBeVisible();
  });

  // D028: Alt+Shift+Z 와 같은 규칙. v1.17.0 은 ON 덮어쓰기와 ● 를 남겼다
  test("OFF 에서 다시 켜면 전역값과 같아져 ● 가 사라지고 항목이 지워진다", async ({ context, extensionId, worker, open, store }) => {
    await store.set({ [KEY]: { banner: false } });
    const page = await open(`<p>글</p>`);
    const popup = await popupFor(context, extensionId, page, worker);
    await sw(popup, "s-banner").click();
    await expect(ov(popup, "banner")).toHaveText("", { timeout: 1000 });
    expect((await store.get())[KEY]).toBeUndefined();
  });

  test("다른 항목이 남아 있으면 그 항목만 빠지고 사이트 항목은 남는다", async ({ context, extensionId, worker, open, store }) => {
    await store.set({ [KEY]: { rightclick: true, selectors: ["#a"] } });
    const page = await open(`<p>글</p>`);
    const popup = await popupFor(context, extensionId, page, worker);
    await sw(popup, "s-rightclick").click();
    await expect(ov(popup, "rightclick")).toHaveText("");
    expect((await store.get())[KEY]).toEqual({ selectors: ["#a"] });
  });

  test("A3: 이 사이트 초기화 확인창에 예외 건수도 나오고, 예외만 있어도 묻는다", async ({ context, extensionId, worker, open, store }) => {
    await store.set({ [KEY]: { ex: [".keep"], selectors: ["#a", "#b"] } });
    const page = await open(`<p>글</p>`);
    const popup = await popupFor(context, extensionId, page, worker);
    const asked = [];
    popup.on("dialog", (d) => { asked.push(d.message()); d.dismiss(); });
    await popup.click("#reset");
    await expect.poll(() => asked.length).toBe(1);
    expect(asked[0]).toBe("숨긴 항목 2건, 예외 1건도 함께 삭제됩니다. 계속할까요?");
    expect((await store.get())[KEY]).toEqual({ ex: [".keep"], selectors: ["#a", "#b"] });

    await store.set({ [KEY]: { ex: [".keep"] } });
    await popup.click("#reset");
    await expect.poll(() => asked.length).toBe(2);
    expect(asked[1]).toBe("예외 1건도 함께 삭제됩니다. 계속할까요?");
    expect((await store.get())[KEY]).toEqual({ ex: [".keep"] });
  });

  test("● 를 누르면 그 항목만 기본값 따름으로 돌아간다", async ({ context, extensionId, worker, open, store }) => {
    await store.set({ [KEY]: { banner: false, copy: true } });
    const page = await open(`<p>글</p>`);
    const popup = await popupFor(context, extensionId, page, worker);
    await ov(popup, "banner").click();
    await expect(ov(popup, "banner")).toHaveText("");
    await expect(popup.locator("#s-banner")).toBeChecked();
    expect((await store.get())[KEY]).toEqual({ copy: true });
    await ov(popup, "copy").click();
    await expect(ov(popup, "copy")).toHaveText("");
    expect((await store.get())[KEY]).toBeUndefined();
  });

  test("전체 기본값 스위치는 global 에 쓰고 덮어쓰지 않은 사이트 스위치가 따라간다", async ({ context, extensionId, worker, open, store }) => {
    const page = await open(`<p>글</p>`);
    const popup = await popupFor(context, extensionId, page, worker);
    await sw(popup, "g-copy").click();
    await expect(popup.locator("#g-copy")).toBeChecked();
    await expect(popup.locator("#s-copy")).toBeChecked();
    expect((await store.get()).global).toEqual({ banner: true, rightclick: false, copy: true, back: true });
    expect((await store.get())[KEY]).toBeUndefined();
  });

  test("http·https 가 아닌 페이지에서는 사이트 스위치·초기화가 잠기고 저장 항목이 생기지 않는다", async ({ context, extensionId, store }) => {
    // 탭으로 연 팝업은 자기 자신(chrome-extension://)을 활성 탭으로 읽는다
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(popup.locator("#host")).toHaveText("(적용할 수 없는 페이지)");
    await expect(popup.locator("#count")).toHaveText("이 페이지에서는 동작하지 않습니다.");
    for (const k of ["banner", "rightclick", "copy", "back"]) await expect(popup.locator(`#s-${k}`)).toBeDisabled();
    await expect(popup.locator("#reset")).toBeDisabled();
    await expect(popup.locator("#diag")).toBeDisabled();
    await sw(popup, "s-banner").click({ force: true });
    await popup.waitForTimeout(200);
    expect(Object.keys(await store.get())).toEqual([]);
  });
});

test.describe("F8 옵션 페이지", () => {
  const options = async (context, extensionId) => {
    const p = await context.newPage();
    await p.goto(`chrome-extension://${extensionId}/options.html`);
    return p;
  };
  const row = (p, h, k) => p.locator(`select[data-host="${h}"][data-key="${k}"]`);

  test("사이트 목록의 3상태 셀렉트: ON·OFF 는 저장하고 기본값 따름은 지운다", async ({ context, extensionId, store }) => {
    await store.set({ "s:other.test": { banner: false } });
    const p = await options(context, extensionId);
    await row(p, "other.test", "copy").selectOption("true");
    await expect.poll(async () => (await store.get())["s:other.test"]).toEqual({ banner: false, copy: true });
    await row(p, "other.test", "banner").selectOption("");
    await expect.poll(async () => (await store.get())["s:other.test"]).toEqual({ copy: true });
    await row(p, "other.test", "copy").selectOption("");
    await expect.poll(async () => (await store.get())["s:other.test"]).toBeUndefined();
  });

  test("옵션 페이지를 연 채 다른 탭의 선택기로 규칙을 추가하고 옵션에서 다른 사이트를 고쳐도 둘 다 남는다", async ({ context, extensionId, worker, open, store, diag }) => {
    await store.set({ "s:other.test": { banner: false } });
    const p = await options(context, extensionId);
    await expect(row(p, "other.test", "copy")).toBeAttached();

    const page = await open(`<p id="t">글</p>`);
    await diag(page, true);
    await page.waitForTimeout(300);
    await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      await chrome.tabs.sendMessage(tab.id, { type: "PICK_START" }, { frameId: 0 });
    });
    await page.click("#t");
    await expect.poll(async () => (await store.get())[KEY]).toEqual({ selectors: ["#t"] });

    await row(p, "other.test", "copy").selectOption("true");
    await expect.poll(async () => (await store.get())["s:other.test"]).toEqual({ banner: false, copy: true });
    expect((await store.get())[KEY]).toEqual({ selectors: ["#t"] });
    // 열려 있던 옵션 페이지도 새 사이트를 보여준다
    await expect(row(p, "uc.test", "banner")).toBeAttached();
  });
});

test.describe("F8 단축키 (배경 처리)", () => {
  test("Alt+Shift+X: 진단을 켜고 끄며 배지로 알리고, 1.5초 뒤 배지를 지운다", async ({ open, worker }) => {
    const page = await open(`<div class="ad-banner" id="x">광고</div>`);
    await page.bringToFront();
    expect(await runCmd(worker, "cmdDiagnose")).toBe("DX");
    await expect(page.locator("#x")).toHaveAttribute("data-uc-why", /./);
    expect(await runCmd(worker, "cmdDiagnose")).toBe("OFF");
    await expect(page.locator("#x")).toBeHidden();
    await page.waitForTimeout(1600);
    expect(await runCmd(worker, "cmdBanner", "about:blank")).toBe("×");
  });

  // ANALYSIS A2: 타이머가 하나라 다른 탭의 배지가 앞 탭의 지우기를 취소해 배지가 남았다
  test("두 탭에서 잇달아 단축키를 써도 각 탭의 배지가 1.5초 뒤 지워진다", async ({ open, worker }) => {
    const a = await open(`<p>a</p>`, "/a");
    const b = await open(`<p>b</p>`, "/b");
    await a.bringToFront();
    const idA = await worker.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].id);
    expect(await runCmd(worker, "cmdDiagnose")).toBe("DX");
    await b.bringToFront();
    expect(await runCmd(worker, "cmdDiagnose")).toBe("DX");
    await a.waitForTimeout(1700);
    expect(await worker.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), idA)).toBe("");
    expect(await runCmd(worker, "cmdBanner", "about:blank")).toBe("×");
  });

  test("Alt+Shift+C: 진단이 꺼져 있으면 함께 켜고 선택기를 연다", async ({ open, worker }) => {
    const page = await open(`<p id="t">글</p>`);
    await page.bringToFront();
    await page.waitForTimeout(300);
    expect(await runCmd(worker, "cmdPicker")).toBe("SEL");
    await expect(page.locator("#__uc_pick")).toBeAttached();
  });

  // D050: 선택기가 켜져 있으면 같은 단축키가 끈다. 진단은 그대로
  test("Alt+Shift+C: 선택기가 켜져 있으면 끄고 배지 OFF, 진단은 켜진 채다", async ({ open, worker }) => {
    const page = await open(`<p id="t">글</p>`);
    await page.bringToFront();
    await page.waitForTimeout(300);
    expect(await runCmd(worker, "cmdPicker")).toBe("SEL");
    await expect(page.locator("#__uc_pick")).toBeAttached();
    expect(await runCmd(worker, "cmdPicker")).toBe("OFF");
    await expect(page.locator("#__uc_pick")).not.toBeAttached();
    const diagOn = await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      return (await chrome.storage.session.get(`diag:${tab.id}`))[`diag:${tab.id}`];
    });
    expect(diagOn).toBe(true);
  });

  test("Alt+Shift+Z: 이 사이트 배너 숨기기를 뒤집고, 전역값과 같아지면 덮어쓰기를 지운다", async ({ open, worker, store }) => {
    const page = await open(`<div class="ad-banner" id="x">광고</div>`);
    await page.bringToFront();
    expect(await runCmd(worker, "cmdBanner", page.url())).toBe("OFF");
    expect((await store.get())[KEY]).toEqual({ banner: false });
    await expect(page.locator("#x")).toBeVisible();
    expect(await runCmd(worker, "cmdBanner", page.url())).toBe("AD");
    expect((await store.get())[KEY]).toBeUndefined();
    await expect(page.locator("#x")).toBeHidden();
  });

  // D052: Chrome 은 단축키를 브라우저에 넘기면 팝업이 닫혀, 팝업이 키를 막고 같은 처리를 부른다
  test("팝업을 연 채 Alt+Shift+X: 팝업이 남고 진단 스위치가 바뀐다", async ({ context, extensionId, worker, open }) => {
    const page = await open(`<p id="t">글</p>`);
    const popup = await popupFor(context, extensionId, page, worker);
    await popup.keyboard.press("Alt+Shift+X");
    await expect(popup.locator("#diag")).toBeChecked();
    await popup.keyboard.press("Alt+Shift+X");
    await expect(popup.locator("#diag")).not.toBeChecked();
    expect(popup.isClosed()).toBe(false);
  });

  test("팝업을 연 채 Alt+Shift+Z: 팝업이 남고 이 사이트 배너 스위치가 바뀐다", async ({ context, extensionId, worker, open, store }) => {
    const page = await open(`<p id="t">글</p>`);
    const popup = await popupFor(context, extensionId, page, worker);
    await popup.keyboard.press("Alt+Shift+Z");
    await expect(popup.locator("#s-banner")).not.toBeChecked();
    expect((await store.get())[KEY]).toEqual({ banner: false });
    expect(popup.isClosed()).toBe(false);
  });

  test("팝업을 연 채 Alt+Shift+C: 켜면 팝업을 닫고, 다시 연 팝업에서 끄면 팝업이 남는다", async ({ context, extensionId, worker, open }) => {
    const page = await open(`<p id="t">글</p>`);
    const popup = await popupFor(context, extensionId, page, worker);
    const closed = popup.waitForEvent("close");
    await popup.keyboard.press("Alt+Shift+C");
    await closed;
    await expect(page.locator("#__uc_pick")).toBeAttached();

    const again = await popupFor(context, extensionId, page, worker);
    await expect(again.locator("#pick")).toBeChecked();
    await again.keyboard.press("Alt+Shift+C");
    await expect(page.locator("#__uc_pick")).not.toBeAttached();
    await expect(again.locator("#pick")).not.toBeChecked();
    await expect(again.locator("#diag")).toBeChecked();
    expect(again.isClosed()).toBe(false);
  });

  // Firefox·토르는 브라우저가 단축키를 처리해 팝업은 키를 받지 못한다. 배경의 처리만 돌려 같은 장면을 만든다
  test("브라우저가 처리한 Alt+Shift+C·Z 도 열린 팝업에 반영된다", async ({ context, extensionId, worker, open, store }) => {
    const page = await open(`<p id="t">글</p>`);
    const popup = await popupFor(context, extensionId, page, worker);
    const id = await popup.evaluate(() => tabId); // eslint-disable-line no-undef
    // eslint-disable-next-line no-undef
    const run = (cmd) => worker.evaluate(([c, t, u]) => runCommand(c, { id: t, url: u }), [cmd, id, page.url()]);

    await run("toggle-banner");
    await expect(popup.locator("#s-banner")).not.toBeChecked();
    expect((await store.get())[KEY]).toEqual({ banner: false });

    const closed = popup.waitForEvent("close");
    await run("start-picker");
    await closed;
    await expect(page.locator("#__uc_pick")).toBeAttached();

    const again = await popupFor(context, extensionId, page, worker);
    await expect(again.locator("#pick")).toBeChecked();
    await run("start-picker");
    await expect(page.locator("#__uc_pick")).not.toBeAttached();
    await expect(again.locator("#pick")).not.toBeChecked();
    expect(again.isClosed()).toBe(false);
  });

  test("전체 설정을 누르면 옵션 페이지가 열리고 팝업은 닫힌다 (D060)", async ({ context, extensionId, worker, open }) => {
    const page = await open(`<p id="t">글</p>`);
    const popup = await popupFor(context, extensionId, page, worker);
    const closed = popup.waitForEvent("close");
    const opened = context.waitForEvent("page");
    await popup.locator("#opts").click();
    await (await opened).waitForURL(/options\.html$/);
    await closed;
  });

  test("제한 페이지에서는 세 단축키 모두 × 배지", async ({ context, worker }) => {
    const page = await context.newPage();
    await page.goto("about:blank");
    await page.bringToFront();
    for (const f of ["cmdDiagnose", "cmdPicker", "cmdBanner"]) expect(await runCmd(worker, f)).toBe("×");
  });

  test("activeTab 이 없어 주소를 못 읽으면 Alt+Shift+Z 는 × 배지", async ({ open, worker, store }) => {
    // 지금 값: 호스트 권한이 없어 executeScript 로도 주소를 못 읽는다. 실제 단축키는 activeTab 을 준다
    await open(`<p>글</p>`);
    expect(await runCmd(worker, "cmdBanner")).toBe("×");
    expect((await store.get())[KEY]).toBeUndefined();
  });
});

test.describe("F8 저장 영역 storage.local (D021)", () => {
  // 설치·업데이트·브라우저 시작 때 배경이 부르는 함수를 직접 부른다
  // eslint-disable-next-line no-undef
  const copy = (worker) => worker.evaluate(() => copyFromSync());
  // schema 는 설정이 아니라 형식 표시라 빼고 비교한다
  const settings = async (store) =>
    Object.fromEntries(Object.entries(await store.get()).filter(([k]) => k !== "schema"));
  const OLD = { schema: 2, global: { banner: false, rightclick: true, copy: false, back: true }, [KEY]: { selectors: ["#mine"] } };

  test("기존 storage.sync 에 설정이 있으면 첫 실행 때 local 로 그대로 복사하고 sync 는 지우지 않는다", async ({ worker, open, store, context, extensionId }) => {
    await store.sync.set(OLD);
    expect(await copy(worker)).toBe("copied");
    expect(await store.get()).toEqual(OLD);
    expect(await store.sync.get()).toEqual(OLD);
    // 화면이 전과 같다: 배너 숨기기 전역 OFF 지만 내 규칙은 숨긴다
    const page = await open(`<div class="ad-banner" id="a">광고</div><div id="mine">내 규칙</div>`);
    await page.waitForTimeout(400);
    await expect(page.locator("#a")).toBeVisible();
    const popup = await popupFor(context, extensionId, page, worker);
    await expect(popup.locator("#g-banner")).not.toBeChecked();
    await expect(popup.locator("#g-rightclick")).toBeChecked();
  });

  test("local 에 설정이 이미 있으면 sync 에서 덮어쓰지 않는다", async ({ worker, store }) => {
    await store.set({ "s:a.test": { copy: true } });
    await store.sync.set(OLD);
    expect(await copy(worker)).toBe("skip");
    expect(await settings(store)).toEqual({ "s:a.test": { copy: true } });
  });

  test("sync 도 비어 있으면 아무것도 쓰지 않는다", async ({ worker, store }) => {
    expect(await copy(worker)).toBe("empty");
    expect(await settings(store)).toEqual({});
  });

  test("복사가 실패하면 옵션 페이지에 오류를 보이고, 다음 실행 때 다시 시도해 성공하면 오류를 지운다", async ({ worker, store, context, extensionId }) => {
    await store.sync.set(OLD);
    // schema 만 남아 있는 상태에서도 다시 시도해야 한다
    await store.set({ schema: 2 });
    const result = await worker.evaluate(async () => {
      const set = chrome.storage.local.set;
      chrome.storage.local.set = () => Promise.reject(new Error("시험용 실패"));
      // eslint-disable-next-line no-undef
      try { return await copyFromSync(); } finally { chrome.storage.local.set = set; }
    });
    expect(result).toBe("error");
    expect(await settings(store)).toEqual({});
    const p = await context.newPage();
    await p.goto(`chrome-extension://${extensionId}/options.html`);
    await expect(p.locator("#quota")).toContainText("이전 설정(storage.sync)을 옮기지 못했습니다: 시험용 실패");

    expect(await copy(worker)).toBe("copied");
    await p.reload();
    await expect(p.locator("#quota")).not.toContainText("옮기지 못했습니다");
    expect(await store.get()).toEqual(OLD);
  });

  test("설정은 local 에 쓰고 sync 에는 쓰지 않는다", async ({ context, extensionId, worker, open, store }) => {
    const page = await open(`<p>글</p>`);
    const popup = await popupFor(context, extensionId, page, worker);
    await sw(popup, "s-banner").click();
    await expect.poll(async () => (await store.get())[KEY]).toEqual({ banner: false });
    expect(await store.sync.get()).toEqual({});
  });

  test("옵션 페이지 용량 줄은 local 한도를 기준으로 보인다", async ({ context, extensionId, store }) => {
    await store.set({ "s:a.test": { selectors: ["#a"] }, "s:bb.test": { copy: true } });
    const p = await context.newPage();
    await p.goto(`chrome-extension://${extensionId}/options.html`);
    await expect(p.locator("#quota")).toHaveText(
      /^\d+(\.\d)?KB \/ 10MB 사용 \(1% 미만\) · 사이트 2개$/);   // D067
    // 구분점은 양옆 여백이 있는 따로 된 칸이다 (D068)
    const sep = p.locator("#quota .sep");
    await expect(sep).toHaveText("·");
    expect(await sep.evaluate((e) => parseFloat(getComputedStyle(e).marginLeft))).toBeGreaterThan(0);
  });

  // 확장을 새로 고치면 워커 공용 브라우저의 서비스 워커가 바뀌므로 이 테스트만 따로 띄운다
  test("실제 업데이트 경로: sync 에만 설정이 있는 상태에서 확장을 새로 고치면 local 로 옮겨진다", async ({}, testInfo) => {
    testInfo.setTimeout(60_000);
    const ext = path.resolve("src");
    const ctx = await chromium.launchPersistentContext("", {
      channel: "msedge", args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
    try {
      let [w] = ctx.serviceWorkers();
      if (!w) w = await ctx.waitForEvent("serviceworker");
      // v1.17.0 이 남긴 모습: sync 에 설정, local 은 비어 있음
      await w.evaluate(async (o) => { await chrome.storage.local.clear(); await chrome.storage.sync.set(o); }, OLD);
      const next = ctx.waitForEvent("serviceworker");
      await w.evaluate(() => chrome.runtime.reload()).catch(() => {});
      w = await next;
      await expect.poll(() => w.evaluate(() => chrome.storage.local.get(null))).toEqual(OLD);
      expect(await w.evaluate(() => chrome.storage.sync.get(null))).toEqual(OLD);
    } finally {
      await ctx.close();
    }
  });
});

test.describe("PRD §2.1 v1.7 옛 형식 제거 (D012)", () => {
  // v1.7 이하가 남긴 형태: sites 한 항목에 { host: 설정 } 을 모두 넣었다
  const LEGACY = { sites: { "uc.test": { banner: false, selectors: ["#mine"] }, "b.test": { copy: true } } };

  test("저장소에 sites 항목만 있으면 읽지 않아 페이지·팝업·옵션 모두 비어 보인다", async ({ context, extensionId, worker, open, store }) => {
    await store.set(LEGACY);
    const page = await open(`<div class="ad-banner" id="ad">광고</div><div id="mine">내 규칙</div>`);
    await expect(page.locator("#ad")).toBeHidden();
    await expect(page.locator("#mine")).toBeVisible();

    const popup = await popupFor(context, extensionId, page, worker);
    await expect(popup.locator("#s-banner")).toBeChecked();
    await expect(ov(popup, "banner")).toHaveText("");

    const p = await context.newPage();
    await p.goto(`chrome-extension://${extensionId}/options.html`);
    await expect(p.locator("#empty")).toBeVisible();
    await expect(p.locator("#quota")).toContainText("사이트 0개");
    await expect(p.locator("#quota")).not.toContainText("옛 형식");
  });

  test("설정을 고쳐도 sites 항목은 지우지 않고 그대로 둔다", async ({ context, extensionId, worker, open, store }) => {
    await store.set(LEGACY);
    const page = await open(`<p>글</p>`);
    await page.bringToFront();
    // Alt+Shift+Z: 옛 항목의 banner:false 를 보지 않고 전역값(ON)에서 뒤집는다
    expect(await runCmd(worker, "cmdBanner", page.url())).toBe("OFF");
    expect((await store.get())[KEY]).toEqual({ banner: false });

    const p = await context.newPage();
    await p.goto(`chrome-extension://${extensionId}/options.html`);
    await p.fill("#sHost", "new.test");
    await p.press("#sHost", "Enter");
    await expect.poll(async () => (await store.get())["s:new.test"]).toEqual({ banner: true });
    expect((await store.get()).sites).toEqual(LEGACY.sites);
  });
});

// D036: v1.17.0 은 사이트 ✕ 를 규칙이 있을 때만 묻고, 나머지 삭제 단추는 묻지 않고 바로 지웠다
test.describe("삭제 확인창 (D036)", () => {
  const SITE = { selectors: ["#a", "#b"], ex: [".keep"], texts: [{ scope: "div", word: "광고" }] };

  // 확인창 문구를 모으고, 그때그때 answer 값대로 답한다
  function answer(p) {
    const st = { asked: [], accept: false };
    p.on("dialog", (d) => { st.asked.push(d.message()); st.accept ? d.accept() : d.dismiss(); });
    return st;
  }
  async function options(context, extensionId) {
    const p = await context.newPage();
    const st = answer(p);
    // 규칙 줄의 ✕ 는 사이트 보기에서 보인다. 모든 사이트 보기는 요약만 (D064)
    await p.goto(`chrome-extension://${extensionId}/options.html#uc.test`);
    await expect(p.locator("#quota")).not.toBeEmpty();
    return { p, st };
  }

  const cases = [
    ["사이트 ✕ (규칙 없음)", { copy: true }, "button[data-del]",
      "uc.test 항목을 삭제할까요?", undefined],
    ["선택자 삭제", SITE, "button[data-sval]",
      "uc.test 의 선택자를 삭제할까요?\n\n#a", { ...SITE, selectors: ["#b"] }],
    ["예외 삭제", SITE, "button[data-eval]",
      "uc.test 의 예외를 삭제할까요?\n\n.keep", { selectors: SITE.selectors, texts: SITE.texts }],
    ["텍스트 규칙 삭제", SITE, "button[data-th]",
      "uc.test 의 텍스트 규칙을 삭제할까요?\n\ndiv · 광고", { selectors: SITE.selectors, ex: SITE.ex }]
  ];
  for (const [what, site, btn, text, after] of cases) {
    test(`옵션 ${what}: 취소하면 그대로, 확인하면 지워진다`, async ({ context, extensionId, store }) => {
      await store.set({ [KEY]: site });
      const { p, st } = await options(context, extensionId);
      await p.locator(btn).first().click();
      await expect.poll(() => st.asked).toEqual([text]);
      expect((await store.get())[KEY]).toEqual(site);

      st.accept = true;
      await p.locator(btn).first().click();
      await expect.poll(async () => (await store.get())[KEY]).toEqual(after);
      expect(st.asked).toEqual([text, text]);
    });
  }

  test("옵션 사이트 ✕ (규칙 있음): 지금 문구로 묻고 취소하면 그대로다", async ({ context, extensionId, store }) => {
    await store.set({ [KEY]: SITE });
    const { p, st } = await options(context, extensionId);
    await p.click("button[data-del]");
    await expect.poll(() => st.asked).toEqual(["uc.test의 숨긴 항목 2건, 예외 1건, 텍스트 규칙 1건도 함께 삭제됩니다. 계속할까요?"]);
    expect((await store.get())[KEY]).toEqual(SITE);
  });

  test("팝업 내가 숨긴 항목 ✕: 취소하면 그대로, 확인하면 지워진다", async ({ context, extensionId, worker, open, store }) => {
    await store.set({ [KEY]: { selectors: ["#a", "#b"] } });
    const page = await open(`<p id="a">가</p><p id="b">나</p>`);
    const popup = await popupFor(context, extensionId, page, worker);
    const st = answer(popup);
    const x = popup.locator("#sels .x").first();
    await x.click();
    await expect.poll(() => st.asked).toEqual(["uc.test 의 선택자를 삭제할까요?\n\n#a"]);
    expect((await store.get())[KEY]).toEqual({ selectors: ["#a", "#b"] });

    st.accept = true;
    await x.click();
    await expect.poll(async () => (await store.get())[KEY]).toEqual({ selectors: ["#b"] });
  });
});

// D035·D048: 왼쪽 사이트 목록에서 고르면 오른쪽 카드가 그 사이트 것만, 찾기칸은 호스트·선택자·낱말로 거른다
test.describe("옵션 긴 목록 (D035)", () => {
  const host = (n) => `site${String(n).padStart(2, "0")}.test`;
  // 사이트 50개, 사이트마다 선택자 10개. 7번 사이트만 예외·텍스트 규칙도 있다
  const MANY = Object.fromEntries(Array.from({ length: 50 }, (_, i) => {
    const n = i + 1, o = { selectors: Array.from({ length: 10 }, (_, k) => `.ad-${n}-${k}`) };
    if (n === 7) Object.assign(o, { ex: [".keep7"], texts: [{ scope: "div", word: "광고7" }] });
    return [`s:${host(n)}`, o];
  }));
  async function options(context, extensionId) {
    const p = await context.newPage();
    const asked = [];
    let accept = false;
    p.on("dialog", (d) => { asked.push(d.message()); accept ? d.accept() : d.dismiss(); });
    await p.goto(`chrome-extension://${extensionId}/options.html`);
    await expect(p.locator("#quota")).not.toBeEmpty();
    return { p, asked, accept: () => { accept = true; } };
  }
  const shownHosts = (p, sel, attr) => p.locator(`${sel}:visible`).evaluateAll(
    (els, a) => [...new Set(els.map((e) => e.getAttribute(a)))], attr);

  const heads = (p, box) => p.locator(`${box} > div[data-host]:visible > div`).allInnerTexts();

  test("모든 사이트 보기에서 세 목록은 사이트마다 호스트 · N개 한 줄이고 규칙 줄은 숨는다 (D064)", async ({ context, extensionId, store }) => {
    await store.set({ "s:a.test": { selectors: [".a1", ".a2"] }, "s:b.test": { selectors: [".b1"], ex: [".kb"] },
                      "s:c.test": { selectors: [".c1", ".c2", ".c3", ".c4"], texts: [{ scope: "div", word: "광고" }] } });
    const { p } = await options(context, extensionId);
    await expect.poll(() => heads(p, "#selbox")).toEqual(["a.test · 2개", "b.test · 1개", "c.test · 4개"]);
    expect(await heads(p, "#exbox")).toEqual(["b.test · 1개"]);
    expect(await heads(p, "#textbox")).toEqual(["c.test · 1개"]);
    await expect(p.locator("button[data-sval]:visible, button[data-eval]:visible, button[data-th]:visible")).toHaveCount(0);
    await expect(p.locator("#siteNav a[data-host]")).toHaveCount(3);
  });

  test("요약 줄을 누르면 그 사이트 보기로 가서 규칙이 모두 보인다 (D064)", async ({ context, extensionId, store }) => {
    await store.set(MANY);
    const { p } = await options(context, extensionId);
    await expect(p.locator("#selbox > div[data-host]:visible")).toHaveCount(50);
    await p.locator(`#selbox > div[data-host="${host(7)}"] > div a`).click();
    await expect(p).toHaveURL(new RegExp(`#${host(7)}$`));
    await expect(p.locator("button[data-sval]:visible")).toHaveCount(10);
    await expect(p.locator("button[data-eval]:visible, button[data-th]:visible")).toHaveCount(2);
  });

  test("사이트를 고르면 세 목록과 사이트 표가 그 사이트 것만 보이고 폼 사이트 칸이 채워진다", async ({ context, extensionId, store }) => {
    await store.set(MANY);
    const { p } = await options(context, extensionId);
    await p.locator(`#siteNav a[data-host="${host(7)}"]`).click();
    await expect(p).toHaveURL(new RegExp(`#${host(7)}$`));
    await expect(p.locator("button[data-sval]:visible")).toHaveCount(10);
    expect(await shownHosts(p, "button[data-sval]", "data-h")).toEqual([host(7)]);
    expect(await shownHosts(p, "button[data-eval]", "data-eh")).toEqual([host(7)]);
    expect(await shownHosts(p, "button[data-th]", "data-th")).toEqual([host(7)]);
    expect(await shownHosts(p, "button[data-del]", "data-del")).toEqual([host(7)]);
    for (const id of ["#nHost", "#xHost", "#tHost"]) await expect(p.locator(id)).toHaveValue(host(7));
    // 모든 사이트로 돌아가면 다시 요약 (D064)
    await p.locator("#siteNav a[data-all]").click();
    await expect(p.locator("#selbox > div[data-host]:visible")).toHaveCount(50);
    await expect(p.locator("button[data-sval]:visible")).toHaveCount(0);
  });

  test("찾기에 선택자 일부를 넣으면 맞는 줄이 펼쳐지고 ✕ 는 확인창을 거치며, 비우면 요약으로 돌아간다", async ({ context, extensionId, store }) => {
    await store.set(MANY);
    const { p, asked } = await options(context, extensionId);
    await p.fill("#find", ".ad-23-4");
    await expect(p.locator("button[data-sval]:visible")).toHaveCount(1);
    expect(await shownHosts(p, "button[data-sval]", "data-h")).toEqual([host(23)]);
    expect(await shownHosts(p, "#siteNav a[data-host]", "data-host")).toEqual([host(23)]);
    expect(await shownHosts(p, "button[data-del]", "data-del")).toEqual([host(23)]);
    await p.locator("button[data-sval]:visible").click();
    await expect.poll(() => asked).toEqual([`${host(23)} 의 선택자를 삭제할까요?

.ad-23-4`]);
    await p.fill("#find", "");
    await expect(p.locator("#selbox > div[data-host]:visible")).toHaveCount(50);
    await expect(p.locator("button[data-sval]:visible")).toHaveCount(0);
  });

  test("고른 사이트 보기에서도 ✕ 는 확인창을 거쳐 지운다", async ({ context, extensionId, store }) => {
    await store.set(MANY);
    const { p, asked, accept } = await options(context, extensionId);
    await p.locator(`#siteNav a[data-host="${host(7)}"]`).click();
    const x = p.locator("button[data-sval]:visible").first();
    await x.click();
    await expect.poll(() => asked).toEqual([`${host(7)} 의 선택자를 삭제할까요?\n\n.ad-7-0`]);
    expect((await store.get(`s:${host(7)}`))[`s:${host(7)}`].selectors).toHaveLength(10);
    accept();
    await x.click();
    await expect.poll(async () => (await store.get(`s:${host(7)}`))[`s:${host(7)}`].selectors).toHaveLength(9);
    // 지운 뒤에도 고른 사이트 보기가 유지된다
    expect(await shownHosts(p, "button[data-sval]", "data-h")).toEqual([host(7)]);
  });
});
