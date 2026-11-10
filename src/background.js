// Chrome 의 service worker 는 여기서 공용 모듈을 읽는다. Firefox 의 background.scripts 는
// manifest 에서 common.js 를 먼저 싣고, 그쪽에는 importScripts 가 없다.
if (typeof importScripts === "function") importScripts("common.js");

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  // 팝업이 막은 단축키 (D052). 탭으로 연 시험 팝업에도 sender.tab 이 있어 주소로 가린다
  if (msg?.type === "COMMAND" && sender.url === chrome.runtime.getURL("popup.html")) {
    runCommand(msg.cmd, msg.tab).finally(() => reply({ ok: true }));
    return true;
  }
  const id = sender.tab?.id;
  if (id === undefined) return;
  // 결과를 응답해야 한다. 응답이 없으면 콘텐츠가 실패로 보고 history 로 한 번 더 움직여
  // Backspace 한 번에 두 페이지씩 갔다 (R§4 T14)
  if (msg?.type === "GO_BACK" || msg?.type === "GO_FORWARD") {
    const go = msg.type === "GO_BACK" ? chrome.tabs.goBack(id) : chrome.tabs.goForward(id);
    go.then(() => reply({ ok: true }), () => reply({ ok: false }));
    return true;
  }
  // 새 문서가 떴다. 새로 고침·다른 주소로 이동하면 진단을 끈다 (R§4 T15). 해시·pushState 는
  // 문서가 그대로라 이 메시지가 오지 않아 유지된다. onUpdated 는 그 둘에도 loading 을 주어 쓸 수 없다
  if (msg?.type === "DOC_START" && sender.frameId === 0) clearDiag(id);
  // Firefox·토르의 평소 숨김. 사용자 시트는 페이지 DOM 에 드러나지 않는다 (D044). 새 것을 넣은 뒤 옛 것을
  // 지워 그 사이에 숨김이 풀리지 않게 한다. 지우기는 넣을 때와 같은 글자여야 한다
  if (msg?.type === "CSS") {
    const target = { tabId: id, frameIds: [sender.frameId] };
    const add = msg.css ? chrome.scripting.insertCSS({ target, css: msg.css, origin: "USER" }) : Promise.resolve();
    add.then(() => msg.old && chrome.scripting.removeCSS({ target, css: msg.old, origin: "USER" }))
      .then(() => reply({ ok: true }), () => reply({ ok: false }));
    return true;
  }
});

/* ---------- 진단 상태 ---------- */
// 탭별 진단 on/off 는 session 의 diag:<tabId> 에 두고 배경만 그 탭을 안다. 콘텐츠는 자기 tabId 를
// 몰라도 되게 바뀔 때마다 그 탭의 최상위 프레임에 알린다 (ANALYSIS A5, S3·S4)
function clearDiag(tabId) {
  chrome.storage.session.remove(`diag:${tabId}`).catch(() => {});
}
chrome.tabs.onRemoved.addListener(clearDiag);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "session") return;
  for (const [k, c] of Object.entries(changes)) {
    const m = /^diag:(\d+)$/.exec(k);
    if (!m) continue;
    chrome.tabs.sendMessage(Number(m[1]), { type: "DIAG", on: !!c.newValue }, { frameId: 0 })
      .catch(() => {});
  }
});

/* ---------- 저장 영역 옮기기 (D021) ---------- */
// 설정은 storage.local 에 둔다. sync 는 100KB·항목당 8KB·512개 한도와 쓰기 속도 제한이 있다.
// local 이 비어 있고 sync 에 설정이 있으면 그대로 복사한다. sync 는 지우지 않아 옛 버전으로
// 되돌릴 수 있다. 실패하면 session 에 오류를 남겨 옵션 페이지가 보여 주고, 다음 실행 때 다시 시도한다.
// schema 만 있는 local 은 빈 것으로 본다. 옵션 페이지의 쓰기가 schema 를 남길 수 있고, 그것만으로
// 건너뛰면 복사가 영영 일어나지 않는다.
const COPY_ERR = "copyErr";
async function copyFromSync() {
  try {
    if (Object.keys(await chrome.storage.local.get(null)).some((k) => k !== "schema")) return "skip";
    const old = await chrome.storage.sync.get(null);
    if (!Object.keys(old).length) return "empty";
    await chrome.storage.local.set(old);
    await chrome.storage.session.remove(COPY_ERR);
    return "copied";
  } catch (e) {
    await chrome.storage.session.set({ [COPY_ERR]: String(e?.message || e) }).catch(() => {});
    return "error";
  }
}

// Firefox·토르는 사용자가 바꾼 단축키가 업데이트 뒤에도 남아 예전 키가 메뉴와 겹친다(토르 기록 S).
// 세 브라우저가 같은 키를 쓰게 manifest 값으로 되돌린다 (D049). Chrome 에는 commands.reset 이 없다
async function resetShortcuts() {
  if (!chrome.commands.reset) return;
  for (const { name } of await chrome.commands.getAll()) await chrome.commands.reset(name);
}

chrome.runtime.onInstalled.addListener(({ reason }) => {
  copyFromSync();
  // 브라우저 업데이트(browser_update)로도 불리므로 확장 설치·업데이트만 본다
  if (reason === "install" || reason === "update") resetShortcuts().catch(() => {});
});
chrome.runtime.onStartup.addListener(() => { copyFromSync(); });


/* ---------- 단축키 ---------- */

// 탭마다 따로 둔다. 하나로 두면 다른 탭의 배지가 앞 탭의 지우기를 취소해 배지가 남았다 (ANALYSIS A2)
const badgeTimers = new Map();

// 알림 권한을 늘리지 않으려고 배지로만 결과를 알린다. 토르에서 한글 두 글자가 잘려 영문 약자로 쓴다 (D053)
function flash(tabId, text, color) {
  chrome.action.setBadgeBackgroundColor({ color, tabId }).catch(() => {});
  chrome.action.setBadgeText({ text, tabId }).catch(() => {});
  clearTimeout(badgeTimers.get(tabId));
  badgeTimers.set(tabId, setTimeout(() => {
    badgeTimers.delete(tabId);
    chrome.action.setBadgeText({ text: "", tabId }).catch(() => {});
  }, 1500));
}

function fail(tabId) {
  flash(tabId, "×", "#c0392b");
}

// 팝업과 같은 규칙: 최상위 프레임에만 보낸다
function askTab(tabId, msg) {
  return chrome.tabs.sendMessage(tabId, msg, { frameId: 0 }).then((res) => res ?? null, () => null);
}

// 확장 설치/새로고침 전에 열려 있던 탭에는 콘텐츠 스크립트가 없다
async function injectContent(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ["common.js", "content.js"]
    });
    return true;
  } catch {
    return false;
  }
}

// 콘텐츠 스크립트가 응답하는지 본다. 없으면(확장 새로 고침 전에 열린 탭) 주입한 뒤 다시 묻는다.
// 다시 묻는 응답이 오기 전에 새 콘텐츠의 DOC_START 가 먼저 도착하므로, 그 뒤의 setDiag 가 지워지지 않는다
async function reach(tabId) {
  const res = await askTab(tabId, { type: "COUNT" });
  if (res) return res;
  if (!(await injectContent(tabId))) return null;
  return await askTab(tabId, { type: "COUNT" });
}

function getDiag(tabId) {
  return chrome.storage.session.get(`diag:${tabId}`)
    .then((o) => !!o[`diag:${tabId}`])
    .catch(() => false);
}

function setDiag(tabId, on) {
  return chrome.storage.session.set({ [`diag:${tabId}`]: on })
    .then(() => true)
    .catch(() => false);
}

async function hostOf(tab) {
  // 주소를 읽을 수 있으면 프로토콜까지 확인한다.
  // chrome://extensions 는 hostname 이 "extensions" 라서 그냥 두면 키가 만들어진다.
  if (tab.url) return hostFromUrl(tab.url);
  // activeTab 권한이 아직 없어 주소를 못 읽는 경우에만 페이지에서 직접 받아온다
  try {
    const [r] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => (location.protocol === "http:" || location.protocol === "https:")
        ? location.hostname
        : ""
    });
    return r?.result || "";
  } catch {
    return "";
  }
}

// 이 사이트 항목만 쓴다. 내용이 비면 항목을 지운다.
function writeSite(key, site) {
  const p = hasContent(site)
    ? chrome.storage.local.set({ [key]: site })
    : chrome.storage.local.remove(key);
  return p.then(() => true).catch(() => false);
}

async function cmdDiagnose(tab) {
  if (!(await reach(tab.id))) { fail(tab.id); return; }
  // 현재 값은 콘텐츠의 state 가 아니라 session 을 기준으로 읽는다
  const on = !(await getDiag(tab.id));
  if (!(await setDiag(tab.id, on))) { fail(tab.id); return; }
  flash(tab.id, on ? "DX" : "OFF", on ? "#e74c3c" : "#7f8c8d");
}

// 진단 상태가 콘텐츠에 반영될 때까지 짧게 기다린다
async function waitDiag(tabId) {
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 30));
    const res = await askTab(tabId, { type: "COUNT" });
    if (res?.diagnose) return true;
  }
  return false;
}

async function cmdPicker(tab) {
  const res = await reach(tab.id);
  if (!res) { fail(tab.id); return; }

  // 켜져 있으면 끈다. 진단은 그대로 둔다 (D050)
  if (res.picking) {
    const r = await askTab(tab.id, { type: "PICK_STOP" });
    if (!r?.ok) { fail(tab.id); return; }
    flash(tab.id, "OFF", "#7f8c8d");
    return;
  }

  if (!res.diagnose) {
    if (!(await setDiag(tab.id, true))) { fail(tab.id); return; }
    if (!(await waitDiag(tab.id))) { fail(tab.id); return; }
  }

  const r = await askTab(tab.id, { type: "PICK_START" });
  if (!r?.ok) { fail(tab.id); return; }   // 하위 프레임이거나 진단이 꺼진 경우
  flash(tab.id, "SEL", "#2d7ff9");
}

async function cmdBanner(tab) {
  const host = await hostOf(tab);
  if (!host) { fail(tab.id); return; }

  const key = SITE_PREFIX + host;
  const o = await chrome.storage.local.get(["global", key]).catch(() => null);
  if (!o) { fail(tab.id); return; }

  const g = { ...DEFAULT_GLOBAL, ...(o.global || {}) };
  const site = (o[key] && typeof o[key] === "object") ? { ...o[key] } : {};
  const next = !(site.banner ?? g.banner);
  // 전역값과 같아지면 오버라이드를 지워 "기본값 따름" 으로 되돌린다
  if (next === g.banner) delete site.banner;
  else site.banner = next;

  if (!(await writeSite(key, site))) { fail(tab.id); return; }
  flash(tab.id, next ? "AD" : "OFF", next ? "#27ae60" : "#7f8c8d");
}

async function runCommand(cmd, tab) {
  if (cmd === "toggle-diagnose") await cmdDiagnose(tab);
  else if (cmd === "start-picker") await cmdPicker(tab);
  else if (cmd === "toggle-banner") await cmdBanner(tab);
  // 열린 팝업이 바뀐 것을 그린다. 팝업이 없으면 받는 쪽이 없어 실패하므로 무시한다 (D052)
  chrome.runtime.sendMessage({ type: "COMMAND_DONE", cmd, tabId: tab.id }).catch(() => {});
}

chrome.commands.onCommand.addListener(async (cmd) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id === undefined || tab.id === chrome.tabs.TAB_ID_NONE) return;
  await runCommand(cmd, tab);
});
