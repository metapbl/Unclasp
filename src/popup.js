const FEATURES = [
  { key: "banner",     label: "배너 숨기기" },
  { key: "rightclick", label: "우클릭 방지 해제" },
  { key: "copy",       label: "복사 방지 해제" },
  { key: "back",       label: "백스페이스 뒤로가기" }
];

let host = "";
let tabId = null;

function siteKey() { return SITE_PREFIX + host; }

let msgTimer;
function warn(text) {
  const el = document.getElementById("msg");
  if (!el) return;
  el.textContent = text;
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => { el.textContent = ""; }, 5000);
}

// 전역값과 현재 사이트만 읽는다.
async function read() {
  // host 가 없으면 "s:" 같은 무의미한 키를 조회하지 않는다
  const keys = host ? ["global", siteKey()] : ["global"];
  let o;
  try { o = await chrome.storage.local.get(keys); }
  catch (err) {
    warn("설정을 읽지 못했습니다: " + err.message);
    return { global: { ...DEFAULT_GLOBAL }, site: {} };
  }
  const global = { ...DEFAULT_GLOBAL, ...(o?.global || {}) };
  if (!host) return { global, site: {} };
  const fresh = o?.[siteKey()];
  const site = (fresh && typeof fresh === "object") ? fresh : {};
  return { global, site };
}

// 저장 실패를 조용히 삼키지 않는다. 실패하면 false 를 돌려준다.
async function write(o) {
  try {
    await chrome.storage.local.set(o);
    return true;
  } catch (err) {
    warn(/quota/i.test(err.message)
      ? "저장 공간이 가득 찼습니다. 전체 설정에서 규칙을 정리하세요."
      : "저장 실패: " + err.message);
    return false;
  }
}

// 이 사이트 항목만 쓴다. 내용이 비면 항목을 지운다.
async function writeSite(site) {
  if (!host) return false;
  if (hasContent(site)) return write({ [siteKey()]: site });
  try {
    await chrome.storage.local.remove(siteKey());
    return true;
  } catch (err) {
    warn("삭제 실패: " + err.message);
    return false;
  }
}

/* ---------- 콘텐츠 스크립트 통신 ---------- */
// 최상위 프레임에만 보낸다. 하위 프레임이 먼저 응답해 결과가 뒤바뀌는 일을 막는다.
function ask(msg) {
  return chrome.tabs.sendMessage(tabId, msg, { frameId: 0 }).then((res) => res ?? null, () => null);
}

// 확장 설치/새로고침 전에 열려 있던 탭에는 콘텐츠 스크립트가 없다
async function ensureInjected() {
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

async function askWithInject(msg) {
  let res = await ask(msg);
  if (res) return res;
  if (!(await ensureInjected())) return null;
  return await ask(msg);
}

/* ---------- UI ---------- */
function build() {
  const rows = document.getElementById("rows");
  for (const f of FEATURES) {
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `
      <span class="n">${f.label}<button class="ov" id="ov-${f.key}"
        aria-label="${f.label} 기본값 따름으로 되돌리기"></button></span>
      <span class="c"><label class="sw">
        <input type="checkbox" id="g-${f.key}" aria-label="${f.label} 전체"><span class="track"></span></label></span>
      <span class="c"><label class="sw">
        <input type="checkbox" id="s-${f.key}" aria-label="${f.label} 이 사이트"><span class="track"></span></label></span>`;
    rows.appendChild(row);
  }
}

function paint(conf) {
  const gAll = conf.global;
  const site = conf.site || {};

  for (const f of FEATURES) {
    const g = gAll[f.key];
    const o = site[f.key];
    const inherit = o === undefined;

    const gEl = document.getElementById(`g-${f.key}`);
    const sEl = document.getElementById(`s-${f.key}`);
    const ov  = document.getElementById(`ov-${f.key}`);

    gEl.checked = g;
    sEl.checked = o ?? g;
    sEl.disabled = !host;

    const wrap = sEl.closest(".sw");
    wrap.classList.toggle("inherit", inherit);
    wrap.title = !host
      ? "이 페이지에는 사이트 설정을 적용할 수 없습니다"
      : (inherit ? "전체 기본값을 따릅니다" : "이 사이트 전용 설정");

    ov.textContent = inherit ? "" : "●";
    ov.title = inherit ? "" : "클릭하면 기본값 따름으로 되돌립니다";
  }
}

// 요소 선택 스위치는 진단 모드일 때만 켤 수 있고, 그 탭의 선택기가 켜져 있으면 켜짐으로 보인다 (D032)
function setPickState(diagOn, picking = false) {
  const pickEl = document.getElementById("pick");
  pickEl.disabled = !diagOn;
  pickEl.checked = diagOn && picking;
  pickEl.closest(".sw").title = diagOn ? "" : "진단 모드를 켜면 사용할 수 있습니다.";
}

/* ---------- 진단 범례 ---------- */
// 페이지의 테두리 색이 무엇을 뜻하는지와 출처별 건수를 함께 보여준다.
// 진단 모드가 아니면 감춘다. 건수는 최상위 프레임 기준이다.
function renderLegend(res) {
  const box = document.getElementById("legend");
  if (!box) return;

  if (!res || !res.diagnose) { box.style.display = "none"; return; }
  box.style.display = "block";

  const rows = [
    ["lg-custom", res.custom,       "직접 지정한 선택자에 걸린 요소"],
    ["lg-base",   res.base,         "내장 기본 선택자에 걸린 요소"],
    ["lg-ex",     res.exHits,       res.nb
                                      ? "기본규칙을 꺼서 숨지 않는 요소"
                                      : "예외나 구조 가드로 살아남은 요소"],
    ["lg-text",   res.textHits,     "텍스트 규칙에 걸린 요소"],
    ["lg-will",   res.willCollapse, "숨긴 요소만 남아 접힐 컨테이너"]
  ];

  for (const [id, n, tip] of rows) {
    const row = document.getElementById(id);
    if (!row) continue;
    const v = typeof n === "number" ? n : 0;
    row.querySelector(".v").textContent = `${v}개`;
    row.classList.toggle("z", v === 0);
    row.title = tip;
    // 비율 띠의 같은 출처 칸 너비
    const bar = box.querySelector(`#ratio .${id.slice(3)}`);
    if (bar) bar.style.flex = String(v);
  }
}

/* ---------- 내가 숨긴 요소 ---------- */
async function removeSelector(sel) {
  if (!host) return;
  if (!confirm(`${host} 의 선택자를 삭제할까요?\n\n${sel}`)) return;
  const { site: cur } = await read();
  const site = { ...cur };
  const list = (site.selectors || []).filter((s) => s !== sel);

  if (list.length) site.selectors = list;
  else delete site.selectors;

  if (!(await writeSite(site))) return;
  await showCount();
}

function renderSels(detail) {
  const head = document.getElementById("selhead");
  const box = document.getElementById("sels");
  box.textContent = "";

  if (!detail || !detail.length) { head.style.display = "none"; return; }
  head.style.display = "block";

  for (const d of detail) {
    const row = document.createElement("div");
    row.className = "s";

    const t = document.createElement("span");
    t.className = "t";
    t.textContent = d.sel;
    t.title = d.sel;

    const b = document.createElement("span");
    if (d.bad) {
      b.className = "badge bad"; b.textContent = "문법 오류";
      b.title = "이 선택자는 적용되지 않습니다.";
    } else if (d.n === 0) {
      b.className = "badge off"; b.textContent = "적용 안 됨";
      b.title = "현재 페이지에서 일치하는 요소가 없습니다. 사이트 구조가 바뀌었을 수 있습니다.";
    } else {
      b.className = "badge ok"; b.textContent = `${d.n}건`;
    }

    const x = document.createElement("button");
    x.className = "x"; x.textContent = "✕"; x.title = "이 규칙 삭제";
    x.setAttribute("aria-label", "이 규칙 삭제");
    x.addEventListener("click", () => removeSelector(d.sel));

    row.append(t, b, x);
    box.appendChild(row);
  }
}

async function showCount() {
  const el = document.getElementById("count");
  const diagEl = document.getElementById("diag");

  if (tabId === null || !host) {
    el.textContent = "이 페이지에서는 동작하지 않습니다.";
    diagEl.disabled = true;
    setPickState(false);
    renderSels([]);
    renderLegend(null);
    return;
  }

  const res = await askWithInject({ type: "COUNT" });
  if (!res) {
    el.textContent = "이 페이지에서는 동작하지 않습니다.";
    diagEl.disabled = true;
    setPickState(false);
    renderSels([]);
    renderLegend(null);
    return;
  }

  let line = `기본 규칙 ${res.base}개 · 내 규칙 ${res.custom}개 (선택자 ${res.rules}건)`;
  if (res.textRules) line += ` · 텍스트 ${res.textHits}개 (규칙 ${res.textRules}건)`;
  el.textContent = line;

  diagEl.disabled = false;
  diagEl.checked = !!res.diagnose;
  setPickState(!!res.diagnose, !!res.picking);
  renderSels(res.detail);
  renderLegend(res);
}

/* ---------- 시작 ---------- */
(async () => {
  build();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id ?? null;
  host = hostFromUrl(tab?.url);

  const hostEl = document.getElementById("host");
  hostEl.textContent = host || "(적용할 수 없는 페이지)";
  hostEl.title = host ? host : "http, https 페이지에서만 사이트 설정을 쓸 수 있습니다";

  // 사이트 항목을 만들 수 없는 페이지에서는 초기화 버튼도 잠근다
  const resetEl = document.getElementById("reset");
  resetEl.disabled = !host;
  if (!host) resetEl.title = "이 페이지에는 사이트 설정이 없습니다";

  paint(await read());
  await showCount();

  for (const f of FEATURES) {
    // 전체 기본값
    document.getElementById(`g-${f.key}`).addEventListener("change", async (e) => {
      const { global } = await read();
      await write({ global: { ...global, [f.key]: e.target.checked } });
      paint(await read());   // 실패했다면 저장된 값으로 되돌아간다
    });

    // 이 사이트 전용 (오버라이드 저장)
    document.getElementById(`s-${f.key}`).addEventListener("change", async (e) => {
      if (!host) return;
      const { global, site } = await read();
      const next = { ...site, [f.key]: e.target.checked };
      // 전역값과 같아지면 덮어쓰기를 지워 "기본값 따름" 으로 돌린다. Alt+Shift+Z 와 같은 규칙 (D028)
      if (next[f.key] === global[f.key]) delete next[f.key];
      await writeSite(next);
      paint(await read());
    });

    // ● 클릭 시 해당 항목만 "기본값 따름"으로 복귀
    document.getElementById(`ov-${f.key}`).addEventListener("click", async () => {
      if (!host) return;
      const { site: cur } = await read();
      if (cur[f.key] === undefined) return;
      const site = { ...cur };
      delete site[f.key];
      await writeSite(site);
      paint(await read());
    });
  }

  // 진단 모드 (탭 단위 임시 상태)
  document.getElementById("diag").addEventListener("change", async (e) => {
    const on = e.target.checked;
    try {
      await chrome.storage.session.set({ [`diag:${tabId}`]: on });
      setPickState(on);
      // 콘텐츠 스크립트의 스캔이 200ms 디바운스를 타므로 그 뒤에 다시 읽는다.
      // 바로 읽으면 접힘 예정 건수가 이전 상태로 나온다.
      setTimeout(() => { showCount(); }, 260);
    } catch (err) {
      warn("진단 모드 전환 실패: " + err.message);
      e.target.checked = !on;
    }
  });

  // 팝업이 열린 동안 이 탭의 진단 상태가 바뀌면(새로 고침·단축키) 스위치·범례를 다시 읽는다 (D033).
  // 콘텐츠가 DIAG 를 받아 다시 그린 뒤에 읽도록 진단 스위치와 같은 만큼 기다린다
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "session" && tabId !== null && Object.hasOwn(changes, `diag:${tabId}`)) {
      setTimeout(() => { showCount(); }, 260);
    }
  });

  // 요소 선택기 시작·끝. 시작하면 페이지를 조준할 수 있게 팝업을 닫는다
  document.getElementById("pick").addEventListener("change", async (e) => {
    if (!e.target.checked) {
      await ask({ type: "PICK_STOP" });
      await showCount();
      return;
    }
    const res = await askWithInject({ type: "PICK_START" });
    if (!res?.ok) {
      e.target.checked = false;
      document.getElementById("count").textContent =
        "이 페이지에서는 골라 숨기기를 쓸 수 없습니다.";
      return;
    }
    window.close();
  });

  // Chrome 은 팝업이 열린 채 단축키를 누르면 팝업이 닫힌다. 키를 막으면 브라우저 단축키도 실행되지 않아
  // 배경의 같은 처리를 직접 부른다 (D052). commands.reset 이 있는 Firefox·토르는 닫히지 않아 그대로 둔다
  if (!chrome.commands.reset) {
    const shortcuts = new Map((await chrome.commands.getAll()).map((c) => [c.shortcut, c.name]));
    document.addEventListener("keydown", async (e) => {
      const combo = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift",
        e.code.replace(/^(Key|Digit)/, "")].filter(Boolean).join("+");
      const cmd = shortcuts.get(combo);
      if (!cmd || cmd === "_execute_action" || tabId === null) return;
      e.preventDefault();
      if (e.repeat) return;
      await chrome.runtime.sendMessage({ type: "COMMAND", cmd, tab: { id: tabId, url: host && `https://${host}/` } });
    });
  }

  // 단축키 처리가 끝났다. 진단은 위의 session 변경으로 다시 그린다
  chrome.runtime.onMessage.addListener(async (msg) => {
    if (msg?.type !== "COMMAND_DONE" || msg.tabId !== tabId) return;
    if (msg.cmd === "toggle-banner") {
      paint(await read());
      await showCount();
    } else if (msg.cmd === "start-picker") {
      // 켜졌으면 스위치로 켤 때처럼 페이지를 조준할 수 있게 닫는다
      if ((await ask({ type: "COUNT" }))?.picking) window.close();
      else await showCount();
    }
  });

  // 이 사이트의 모든 설정과 규칙 삭제
  document.getElementById("reset").addEventListener("click", async () => {
    if (!host) return;
    const { site } = await read();
    const nSel = (site.selectors || []).length;
    const nEx  = (site.ex || []).length;
    const nTxt = (site.texts || []).length;
    // 예외도 사용자가 하나씩 등록한 규칙이라 함께 알린다 (ANALYSIS A3)
    if (nSel + nEx + nTxt) {
      const parts = [];
      if (nSel) parts.push(`숨긴 항목 ${nSel}건`);
      if (nEx)  parts.push(`예외 ${nEx}건`);
      if (nTxt) parts.push(`텍스트 규칙 ${nTxt}건`);
      if (!confirm(`${parts.join(", ")}도 함께 삭제됩니다. 계속할까요?`)) return;
    }

    if (!(await writeSite({}))) return;
    paint(await read());
    await showCount();
  });

  // 옵션 페이지 열기
  document.getElementById("opts").addEventListener("click", async () => {
    if (chrome.runtime.openOptionsPage) await chrome.runtime.openOptionsPage();
    else window.open(chrome.runtime.getURL("options.html"));
    window.close();   // Firefox·토르는 저절로 닫히지 않는다 (D060)
  });
})();
