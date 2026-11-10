// Firefox ESR·토르에 빌드한 xpi 를 임시 설치해 인수 테스트를 돌리는 도우미 (D040).
// Playwright 의 Firefox 는 확장을 설치하지 못해 selenium-webdriver(geckodriver)를 쓴다.
import { Builder, until } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";
import { describe, before, after, beforeEach } from "node:test";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export { By, Key } from "selenium-webdriver";

// 확장 페이지 주소를 알 수 있게 내부 uuid 를 고정한다
const UUID = "0b1e4c2a-5d6f-4e7a-9b8c-1d2e3f4a5b6c";
export const EXT_ORIGIN = `moz-extension://${UUID}`;

// 같은 테스트를 두 브라우저에서 돌린다. 실행 파일은 환경 변수로 받는다. Firefox 는 없으면 기본 설치 경로,
// 토르는 설치 경로가 정해져 있지 않아 기본값이 없다 (개인 경로를 공개본에 남기지 않음).
// 실행 파일이 없으면 그 브라우저의 테스트를 건너뛰고 이유를 남긴다
export const BROWSERS = [
  ["Firefox ESR", process.env.UC_FIREFOX ?? "C:\\Program Files\\Mozilla Firefox\\firefox.exe", "UC_FIREFOX"],
  ["토르", process.env.UC_TOR ?? "", "UC_TOR"],
].map(([name, bin, env]) => ({ name, bin, skip: existsSync(bin) ? false : `실행 파일 없음: ${bin} (${env} 로 지정)` }));

// 토르가 tor 네트워크에 붙지 않게 한다. Firefox 는 이 값을 보지 않는다
process.env.TOR_SKIP_LAUNCH = "1";
process.env.TOR_PROVIDER = "none";

// 내려받은 파일과 올릴 파일을 두는 임시 폴더
const TMP = mkdtempSync(path.join(os.tmpdir(), "uc-gecko-"));
export const DOWNLOADS = path.join(TMP, "down");

let xpi;
function buildXpi() {
  if (xpi) return xpi;
  execFileSync("pwsh", ["-NoProfile", "-File", "scripts/build.ps1"], { stdio: "ignore" });
  const { version } = JSON.parse(readFileSync("src/manifest.json", "utf8"));
  return (xpi = path.resolve(`dist/unclasp-${version}.xpi`));
}

// 시험 페이지는 127.0.0.1 의 로컬 서버로 띄운다. Selenium 에는 Playwright 의 route 가 없다.
// pages: { "/path": "<html>" }. 여러 번 불러도 합쳐진다
export async function startServer() {
  const pages = {};
  const server = createServer((req, res) => {
    const body = pages[new URL(req.url, "http://x").pathname];
    res.writeHead(body === undefined ? 404 : 200, { "content-type": "text/html; charset=utf-8" });
    res.end(body ?? "");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    serve: (p) => Object.assign(pages, p),
    close: () => new Promise((r) => server.close(r)),
  };
}
export const KEY = "s:127.0.0.1";

// driver.installAddon 은 xpi 를 임시 사본으로 설치하고 지워, Firefox 가 나중에 읽는 콘텐츠 스크립트를
// 못 싣는다("Unable to load script"). dist 의 파일을 직접 임시 설치한다. 같은 id 로 다시 부르면
// 업데이트라 저장소는 남고 onInstalled 가 돈다. 토르는 늘 사생활 보호 모드라 사용자가 실기기에서
// 켜는 "사생활 보호 창에서 실행" 권한을 설치 전에 준다
export async function install(driver) {
  await driver.setContext("chrome");
  const error = await driver.executeAsyncScript(`const done = arguments[1]; (async () => {
    const { ExtensionPermissions } = ChromeUtils.importESModule("resource://gre/modules/ExtensionPermissions.sys.mjs");
    const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
    const { FileUtils } = ChromeUtils.importESModule("resource://gre/modules/FileUtils.sys.mjs");
    await ExtensionPermissions.add("unclasp@localhost", { permissions: ["internal:privateBrowsingAllowed"], origins: [] });
    await AddonManager.installTemporaryAddon(new FileUtils.File(arguments[0]));
  })().then(() => done(null), (e) => done(String(e)));`, buildXpi());
  await driver.setContext("content");
  if (error) throw new Error(`확장 설치 실패: ${error}`);
}

// 임시 프로필로 띄우므로 사용자 프로필은 건드리지 않는다
export async function launch(browser) {
  const options = new firefox.Options().setBinary(browser.bin).addArguments("-headless")
    .setPreference("extensions.webextensions.uuids", JSON.stringify({ "unclasp@localhost": UUID }))
    // 백업 저장(a[download])을 묻지 않고 이 폴더에 내려받는다
    .setPreference("browser.download.folderList", 2)
    .setPreference("browser.download.dir", DOWNLOADS)
    .setPreference("browser.download.useDownloadDir", true)
    .setPreference("browser.download.always_ask_before_handling_new_types", false)
    .setPreference("browser.download.alwaysOpenPanel", false)
    // 아래는 토르용. 로컬 서버를 프록시 없이 열고, 영어 페이지 요청 확인창을 띄우지 않는다
    .setPreference("network.proxy.type", 0)
    .setPreference("network.proxy.allow_hijacking_localhost", false)
    .setPreference("privacy.spoof_english", 1);
  // 확장 페이지(moz-extension://)로 이동하고 브라우저 쪽 코드를 돌리려면 시스템 접근을 열어야 한다.
  // 브라우저 인자로는 막혀 있어 geckodriver 쪽 플래그로 연다
  const service = new firefox.ServiceBuilder().addArguments("--allow-system-access");
  const driver = await new Builder().forBrowser("firefox").setFirefoxOptions(options)
    .setFirefoxService(service).build();
  try { await install(driver); } catch (e) { await driver.quit(); throw e; }
  return driver;
}

// 브라우저마다 describe 를 하나씩 만든다. t.driver·t.server 는 before 에서 채운다.
// 테스트마다 시험 페이지 탭 하나만 남기고 저장소를 비운다
export function suite(title, body) {
  for (const browser of BROWSERS) describe(`${browser.name} ${title}`, { skip: browser.skip }, () => {
    const t = { browser };
    before(async () => { t.server = await startServer(); t.driver = await launch(browser); });
    after(async () => { await t.driver?.quit(); await t.server?.close(); });
    beforeEach(async () => {
      const [first, ...rest] = await t.driver.getAllWindowHandles();
      for (const h of rest) { await t.driver.switchTo().window(h); await t.driver.close(); }
      await t.driver.switchTo().window(first);
      await t.driver.get("about:blank");
      await ext(t.driver, `() => Promise.all([browser.storage.local.clear(), browser.storage.sync.clear(), browser.storage.session.clear()])`);
      rmSync(DOWNLOADS, { recursive: true, force: true });
    });
    body(t);
  });
}

// 확장 페이지 탭을 잠시 열어 code(arg, tabId) 를 돌리고 돌아온다. tabId 는 지금 탭(시험 페이지)의 id.
// 시험 페이지는 콘텐츠 스크립트가 도는 호스트 권한이 있어 주소로 찾을 수 있다
export async function ext(driver, code, arg = null) {
  const back = await driver.getWindowHandle();
  const url = await driver.getCurrentUrl();
  await driver.switchTo().newWindow("tab");
  try {
    await driver.get(`${EXT_ORIGIN}/options.html`);
    const r = await driver.executeAsyncScript(`const [arg, url, done] = arguments;
      browser.tabs.query({}).then(async (tabs) => {
        const tab = tabs.find((x) => x.url === url);
        try { done({ ok: await (${code})(arg, tab?.id) }); } catch (e) { done({ error: String(e) }); }
      });`, arg, url);
    if (r.error) throw new Error(r.error);
    return r.ok;
  } finally {
    await driver.close();
    await driver.switchTo().window(back);
  }
}

// 확장 저장소는 storage.local (D021). sync 는 옛 버전의 설정을 옮기는 시험에서만 쓴다
export function store(driver) {
  const area = (n) => ({
    set: (o) => ext(driver, `(o) => browser.storage.${n}.set(o)`, o),
    get: (k = null) => ext(driver, `(k) => browser.storage.${n}.get(k)`, k),
  });
  return { ...area("local"), sync: area("sync") };
}
export const site = async (driver) => (await store(driver).get(KEY))[KEY];

// 진단 모드 켜고 끄기. 팝업처럼 session 에 쓰면 배경이 그 탭에 알린다
export async function diag(driver, on) {
  await ext(driver, `(on, id) => browser.storage.session.set({ ["diag:" + id]: on })`, on);
  await sleep(300);
}

// 진단을 켜고 선택기를 연다. 팝업의 "요소 선택" 처럼 최상위 프레임에 PICK_START 를 보낸다
export async function pick(driver) {
  await diag(driver, true);
  const res = await ext(driver, `(_, id) => browser.tabs.sendMessage(id, { type: "PICK_START" }, { frameId: 0 })`);
  if (!res?.ok) throw new Error("선택기를 열지 못함");
  await poll(() => driver.executeScript("return !!document.getElementById('__uc_pick')"));
}

// 팝업은 활성 탭을 읽는다. 뒤쪽 탭으로 열면 그 창의 활성 탭(시험 페이지)을 읽으므로 실제 팝업과 같다.
// 옮겨 가면 팝업 탭이 활성 탭이 되므로 팝업이 다 뜨고 시작 코드가 탭을 읽은 뒤에 옮긴다.
// 돌아올 때는 돌려준 handle 로 switchTo
export async function popup(driver) {
  const page = await driver.getWindowHandle();
  const before = new Set(await driver.getAllWindowHandles());
  await driver.setContext("chrome");
  await driver.executeScript(`window.__ucPopup = gBrowser.addTab(arguments[0], { inBackground: true,
    triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });`, `${EXT_ORIGIN}/popup.html`);
  await poll(() => driver.executeScript(`const b = window.__ucPopup.linkedBrowser;
    return b.currentURI.spec.endsWith("popup.html") && !b.webProgress.isLoadingDocument;`));
  await sleep(500);
  await driver.setContext("content");
  const h = await poll(async () => (await driver.getAllWindowHandles()).find((x) => !before.has(x)));
  await driver.switchTo().window(h);
  await poll(() => driver.executeScript("return document.querySelectorAll('#rows .row').length === 4"));
  await sleep(300);
  return page;
}

// 시험 페이지를 띄운다. body 만 주면 문서 틀을 씌운다
export async function open(t, body, p = "/") {
  t.server.serve({ [p]: `<!doctype html><meta charset="utf-8"><title>t</title><body>${body}</body>` });
  await t.driver.get(t.server.origin + p);
}

// 페이지 스크립트가 만든 값(window.hits 같은)은 Marionette 의 격리 창에서 안 보여 wrappedJSObject 로 읽는다
export const pageValue = async (driver, expr) => JSON.parse(await driver.executeScript(
  `const w = window.wrappedJSObject ?? window; return JSON.stringify(${expr}) ?? "null";`));

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// fn 이 참값을 돌려줄 때까지 기다린다. 시간이 다 되면 마지막 값을 돌려준다
export async function poll(fn, timeout = 3000) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v || Date.now() > end) return v;
    await sleep(100);
  }
}

// 요소가 안 보이는지. 숨김은 콘텐츠 스크립트가 비동기로 걸므로 잠시 기다리며 본다
const HIDDEN = "const e = document.querySelector(arguments[0]); return !e || e.getClientRects().length === 0 || getComputedStyle(e).visibility === 'hidden';";
export const isHidden = (driver, css, timeout = 3000) => poll(() => driver.executeScript(HIDDEN, css), timeout);
export const isShown = async (driver, css, wait = 400) => { await sleep(wait); return !(await driver.executeScript(HIDDEN, css)); };

export const attr = (driver, css, name) => driver.executeScript(
  "return document.querySelector(arguments[0])?.getAttribute(arguments[1]) ?? null", css, name);
export const hasClass = (driver, css, cls) => driver.executeScript(
  "return !!document.querySelector(arguments[0])?.classList.contains(arguments[1])", css, cls);
export const text = (driver, css) => driver.executeScript("return document.querySelector(arguments[0])?.textContent ?? null", css);

// 키 조합 누르기. press(driver, Key.CONTROL, "z")
export async function press(driver, ...keys) {
  const a = driver.actions();
  for (const k of keys.slice(0, -1)) a.keyDown(k);
  a.sendKeys(keys.at(-1));
  for (const k of keys.slice(0, -1).reverse()) a.keyUp(k);
  await a.perform();
}

// confirm·alert 를 기다려 문구를 돌려주고 accept 면 확인, 아니면 취소한다. 없으면 null
export async function dialog(driver, accept = true, timeout = 2000) {
  try { await driver.wait(until.alertIsPresent(), timeout); } catch { return null; }
  const a = await driver.switchTo().alert();
  const msg = await a.getText();
  await (accept ? a.accept() : a.dismiss());
  return msg;
}

// 복구 파일을 써서 옵션 페이지의 #file 에 넣는다
export async function upload(driver, content, name = "settings-backup.json") {
  const dir = mkdtempSync(path.join(TMP, "up-"));
  const file = path.join(dir, name);
  writeFileSync(file, Buffer.isBuffer(content) ? content : typeof content === "string" ? content : JSON.stringify(content));
  await driver.findElement({ css: "#file" }).sendKeys(file);
}

// 내려받은 파일 하나를 기다려 이름과 JSON 을 돌려준다
export async function downloaded() {
  // 파일 이름이 먼저 생기고 내용은 나중에 써질 수 있어, 읽혀서 JSON 이 될 때까지 기다린다 (T24)
  const got = await poll(() => {
    const name = existsSync(DOWNLOADS) && readdirSync(DOWNLOADS).find((f) => f.endsWith(".json"));
    if (!name) return null;
    try { return { name, json: JSON.parse(readFileSync(path.join(DOWNLOADS, name), "utf8")) }; } catch { return null; }
  }, 5000);
  if (!got) throw new Error("내려받은 파일 없음 또는 내용이 다 써지지 않음");
  return got;
}
