import { test as base, chromium } from "@playwright/test";
import path from "node:path";

const EXT = path.resolve("src");

// 시험 페이지는 이 호스트로 띄운다. 외부 사이트에 접속하지 않는다.
export const ORIGIN = "http://uc.test";

export const test = base.extend({
  // 브라우저는 워커마다 한 번만 띄운다. 테스트마다 띄우면 하나에 7초씩 걸린다.
  extContext: [async ({}, use) => {
    // Playwright 의 Chromium 은 이 PC 에서 SxS 오류로 뜨지 않고(R§4 T13), 정식 Chrome 은
    // --load-extension 을 막는다. 같은 Chromium 엔진인 Edge 로 돌린다 (D025).
    const context = await chromium.launchPersistentContext("", {
      channel: "msedge",
      args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]
    });
    await use(context);
    await context.close();
  }, { scope: "worker" }],
  worker: [async ({ extContext }, use) => {
    let [sw] = extContext.serviceWorkers();
    if (!sw) sw = await extContext.waitForEvent("serviceworker");
    await use(sw);
  }, { scope: "worker" }],
  extensionId: [async ({ worker }, use) => {
    await use(new URL(worker.url()).host);
  }, { scope: "worker" }],
  // 테스트마다 저장소를 비운다. context 를 받지 않는 테스트도 비워야 해서 auto 로 둔다.
  clean: [async ({ worker }, use) => {
    // sync 는 분당 쓰기 120회 한도가 있어, 비어 있으면 지우지 않는다 (clear 도 쓰기로 센다)
    await worker.evaluate(async () => Promise.all([
      chrome.storage.local.clear(), chrome.storage.session.clear(),
      (await chrome.storage.sync.getBytesInUse(null)) ? chrome.storage.sync.clear() : null]));
    await use();
  }, { auto: true }],
  // 끝나면 연 탭과 라우트를 정리해 서로 영향을 주지 않게 한다.
  context: async ({ extContext }, use) => {
    const before = new Set(extContext.pages());
    await use(extContext);
    await extContext.unrouteAll({ behavior: "ignoreErrors" });
    for (const p of extContext.pages()) if (!before.has(p)) await p.close();
  },
  // pages: { "/path": "<html>" } 를 ORIGIN 아래에 응답한다. 여러 번 불러도 합쳐진다.
  serve: async ({ context }, use) => {
    const all = {};
    await context.route(`${ORIGIN}/**`, (route) => {
      const body = all[new URL(route.request().url()).pathname];
      if (body === undefined) return route.fulfill({ status: 404, body: "" });
      return route.fulfill({ contentType: "text/html; charset=utf-8", body });
    });
    await use(async (pages) => { Object.assign(all, pages); });
  },
  // 확장 저장소는 storage.local (D021). sync 는 옛 버전의 설정을 옮기는 시험에서만 쓴다.
  store: async ({ worker }, use) => {
    const area = (name) => ({
      set: (o) => worker.evaluate(([n, x]) => chrome.storage[n].set(x), [name, o]),
      get: (k = null) => worker.evaluate(([n, x]) => chrome.storage[n].get(x), [name, k]),
      clear: () => worker.evaluate((n) => chrome.storage[n].clear(), name)
    });
    await use({ ...area("local"), sync: area("sync") });
  },
  // body 를 담은 시험 페이지를 새 탭에 연다
  open: async ({ context, serve }, use) => {
    await use(async (body, path = "/") => {
      await serve({ [path]: `<!doctype html><meta charset="utf-8"><title>t</title><body>${body}</body>` });
      const page = await context.newPage();
      await page.goto(ORIGIN + path);
      return page;
    });
  },
  // 진단 모드 켜고 끄기. 팝업처럼 session 에 쓰면 배경이 그 탭에 알린다
  // tabs 권한이 없어 주소로 탭을 찾을 수 없으므로 앞으로 가져온 뒤 활성 탭을 쓴다.
  diag: async ({ worker }, use) => {
    await use(async (page, on) => {
      await page.bringToFront();
      await worker.evaluate(async (v) => {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        await chrome.storage.session.set({ [`diag:${tab.id}`]: v });
      }, on);
    });
  }
});

export { expect } from "@playwright/test";
