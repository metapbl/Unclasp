const FEATURES = [
  { key: "banner",     label: "배너 숨기기",         short: "배너" },
  { key: "rightclick", label: "우클릭 방지 해제",     short: "우클릭" },
  { key: "copy",       label: "복사 방지 해제",       short: "복사" },
  { key: "back",       label: "백스페이스 뒤로가기",   short: "백스페이스" }
];

const SCHEMA = 2;

// 복구 파일 크기 상한. storage.sync 시절 한도(약 100KB)를 기준으로 정했고, local 로 옮긴 뒤에도
// 실제 설정은 이보다 훨씬 작으므로 이보다 큰 파일은 잘못 고른 것으로 보고 읽지 않는다.
const MAX_FILE = 1024 * 1024;

// 한 규칙의 제외 단어 상한. 더 늘려야 하는 상황이면 낱말이나 범위가 잘못
// 잡힌 것이고, 항목 크기도 8,192바이트 한도를 향해 커진다.
const MAX_NOT = 5;

// 텍스트 규칙의 일치 방식. 저장 값은 texts 원소의 m 키이고, 키가 없으면 포함
// 검사다. 폼 select 의 value 를 그대로 저장 값으로 써서 "" 가 포함을 뜻한다.
// 목록 줄과 토스트 문구를 한 자리에서 만들기 위한 표다.
const MODE_PRE  = { "": "안에",  eq: "글자가",   re: "안에" };
const MODE_POST = { "": "포함",  eq: "와 같음",  re: "정규식 일치" };

// 정규식 소스 길이 상한. content.js 의 RE_MAX 와 같아야 한다. 더 길어야 하는
// 상황이면 범위를 좁히는 편이 맞고, 되추적이 심한 패턴을 막는 방어이기도 하다.
const MAX_RE = 100;

// 저장된 규칙에서 일치 방식을 읽는다. 모르는 값은 포함으로 본다.
function modeOf(r) {
  return (r && (r.m === "eq" || r.m === "re")) ? r.m : "";
}

const $ = (id) => document.getElementById(id);

// 요소가 없으면 조용히 건너뛴다
function on(id, event, fn) {
  const el = $(id);
  if (el) el.addEventListener(event, fn);
}

function getAll() {
  return chrome.storage.local.get(null).then((o) => o || {}, () => ({}));
}

// s:<host> 항목들을 모아 { global, sites } 모양으로 돌려준다. v1.7 이하의 옛 sites 항목은
// 읽지도 지우지도 않는다 (D012)
async function read() {
  const all = await getAll();
  const global = { ...DEFAULT_GLOBAL, ...(all.global || {}) };
  const sites = {};

  for (const k of Object.keys(all)) {
    if (!k.startsWith(SITE_PREFIX)) continue;
    const h = k.slice(SITE_PREFIX.length);
    if (h && all[k] && typeof all[k] === "object") sites[h] = all[k];
  }
  return { global, sites };
}

// 저장 실패(용량 초과 등)를 사용자에게 알린다. 실패하면 false 를 돌려준다.
async function write(o) {
  try {
    await chrome.storage.local.set(o);
    return true;
  } catch (err) {
    say(/quota/i.test(err.message)
      ? "저장 공간이 부족합니다. 규칙을 줄이거나 필요 없는 사이트를 삭제하세요."
      : "저장 실패: " + err.message, true);
    return false;
  }
}

async function removeKeys(keys) {
  if (!keys.length) return true;
  try {
    await chrome.storage.local.remove(keys);
    return true;
  } catch (err) {
    say("삭제 실패: " + err.message, true);
    return false;
  }
}

/* ---------- 쓰기 경로 직렬화 ---------- */
// 셀렉트를 빠르게 두 번 바꾸면 각 핸들러가 저장 전 상태를 읽어 서로를 덮었다.
// 쓰기 작업은 이 큐에 넣어 한 번에 하나만 돌게 한다.
let writeChain = Promise.resolve();
function queueWrite(fn) {
  const run = writeChain.then(fn, fn);
  writeChain = run.then(() => {}, () => {});
  return run;
}

// { host: site } 모습을 받아 호스트별 항목으로 반영한다.
//
// base 는 이 변경을 만들 때 기준으로 읽은 read().sites 다.
// 삭제는 base 가 알고 있던 호스트에만 적용한다. read() 와 이 호출 사이에
// 팝업이나 요소 선택기가 새로 만든 항목은 이 호출이 모르는 항목이므로
// next 에 없어도 지우지 않는다. 예전 구현은 next 에 없으면 전부 지웠고,
// 그래서 옵션 페이지를 열어 둔 채 다른 탭에서 요소를 숨기면 그 규칙이
// 다음 옵션 조작 한 번에 사라졌다.
//
// prune 은 사이트 목록 전체를 의도적으로 갈아엎을 때만 켠다.
// (전체 삭제, 초기화, 파일에서 복구)
function writeSites(next, base, opts) {
  return queueWrite(() => writeSitesNow(next, base, opts));
}

async function writeSitesNow(next, base, opts) {
  const prune = !!(opts && opts.prune);
  const all = await getAll();
  const map = next || {};
  const set = {};
  const remove = [];

  for (const [h, s] of Object.entries(map)) {
    if (!h || !hasContent(s)) continue;
    const k = SITE_PREFIX + h;
    if (stable(all[k]) !== stable(s)) set[k] = s;
  }

  for (const k of Object.keys(all)) {
    if (!k.startsWith(SITE_PREFIX)) continue;
    const h = k.slice(SITE_PREFIX.length);
    if (hasContent(map[h])) continue;                 // 그대로 남길 항목
    if (prune) { remove.push(k); continue; }
    if (base && Object.prototype.hasOwnProperty.call(base, h)) remove.push(k);
    // base 에 없던 호스트는 모르는 항목이라 건드리지 않는다
  }

  if (all.schema !== SCHEMA) set.schema = SCHEMA;

  if (Object.keys(set).length && !(await write(set))) return false;
  return await removeKeys(remove);
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// 속성 값으로 넣을 때는 따옴표까지 막는다. 선택자에는 [src*="doubleclick"] 처럼
// 큰따옴표가 들어가고, 그 값을 data-* 에 실으면 속성이 그 자리에서 끊긴다.
// 삭제 단추의 대조 값이 바로 그 경우다(i-5-D).
function escAttr(s) {
  return esc(s).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/* ---------- 알림 토스트 ---------- */
// 색은 options.html 의 .err 클래스가 맡는다. 인라인 색을 쓰지 않는다.
// 숨기기는 CSS 의 #msg:empty 가 맡으므로 내용만 비우면 된다.
let msgTimer;
function say(text, err) {
  const el = $("msg");
  if (!el) return;
  clearTimeout(msgTimer);
  el.textContent = text;
  el.classList.toggle("err", !!err);
  msgTimer = setTimeout(hideMsg, 2600);
}

function hideMsg() {
  const el = $("msg");
  if (!el) return;
  clearTimeout(msgTimer);
  el.textContent = "";
  el.classList.remove("err");
}

function normHost(raw) {
  let s = (raw || "").trim();
  if (!s) return "";
  try { if (/^https?:\/\//i.test(s)) s = new URL(s).hostname; } catch { /* 무시 */ }
  return s.replace(/^\/+|\/+$/g, "").toLowerCase();
}

/* ---------- 입력 폼 공통 ---------- */
// 네 폼이 같은 검증을 쓴다. 실패하면 토스트로 알리고 문제가 있는 칸으로
// 포커스를 보낸다. prompt 경로는 이 페이지가 활성 탭이 아닐 때 null 을 받아
// 조용히 버려졌고, 콘솔에 "dialog was suppressed" 만 남았다(i-5-E).
function readHost(el) {
  const h = normHost(el ? el.value : "");
  if (!h) {
    say("사이트 호스트를 입력하십시오. 예: example.com", true);
    if (el) el.focus();
    return "";
  }
  return h;
}

// 선택자 칸을 읽고 문법까지 확인한다. 빈 값과 잘못된 문법을 구분해 알린다.
function readSelector(el, what) {
  const s = (el ? el.value : "").trim();
  if (!s) {
    say(`${what}를 입력하십시오.`, true);
    if (el) el.focus();
    return "";
  }
  try { document.querySelector(s); }
  catch {
    say("선택자 문법이 잘못되었습니다.", true);
    if (el) { el.focus(); el.select(); }
    return "";
  }
  return s;
}

/* ---------- 전체 기본값 ---------- */
function renderGlobal(conf) {
  const g = conf.global;
  const body = $("gbody");
  if (!body) return;
  body.textContent = "";

  for (const f of FEATURES) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${f.label}</td>
      <td class="c"><select data-g="${f.key}">
        <option value="true">ON</option><option value="false">OFF</option>
      </select></td>`;
    body.appendChild(tr);
    tr.querySelector("select").value = String(g[f.key]);
  }

  body.querySelectorAll("select[data-g]").forEach((sel) => {
    sel.addEventListener("change", async () => {
      const c = await read();
      if (!(await write({
        global: { ...c.global, [sel.dataset.g]: sel.value === "true" }
      }))) { refresh(); return; }
      say("전체 기본값을 저장했습니다.");
      refresh();
    });
  });
}

/* ---------- 호스트 제안 목록 ---------- */
// 네 폼이 함께 쓴다. 폼 입력값은 건드리지 않는다. 사용자가 타이핑하는 중에도
// refresh 가 돌 수 있어서, 여기서 value 를 만지면 입력이 튄다(i-5-E).
function renderHostList(conf) {
  const dl = $("hostlist");
  if (!dl) return;
  dl.textContent = "";
  for (const h of Object.keys(conf.sites || {}).sort()) {
    const o = document.createElement("option");
    o.value = h;
    dl.appendChild(o);
  }
}

/* ---------- 사이트별 설정 ---------- */
function buildHead() {
  const tr = $("shead");
  if (!tr) return;
  let cells = "";
  for (const f of FEATURES) {
    cells += `<th class="c" title="${f.label}">${f.short || f.label}</th>`;
  }
  cells += `<th class="c" title="내장 배너 선택자 사용 여부">기본규칙</th>`;
  tr.innerHTML = `<th>사이트</th>${cells}<th class="x"></th>`;
}

function renderSites(conf) {
  const sites = conf.sites || {};
  const hosts = Object.keys(sites).sort();
  const body = $("sbody");
  if (!body) return;
  body.textContent = "";

  if ($("empty")) $("empty").hidden = hosts.length > 0;
  if ($("cnt")) $("cnt").textContent = hosts.length ? `(${hosts.length}개)` : "";

  for (const host of hosts) {
    const o = sites[host] || {};
    const tr = document.createElement("tr");
    tr.dataset.host = host;

    let cells = "";
    for (const f of FEATURES) {
      cells += `<td class="c"><select data-host="${escAttr(host)}" data-key="${f.key}">
        <option value="">기본값 따름</option>
        <option value="true">ON</option>
        <option value="false">OFF</option>
      </select></td>`;
    }
    cells += `<td class="c"><select data-nbhost="${escAttr(host)}">
      <option value="">사용</option>
      <option value="true">끔</option>
    </select></td>`;

    const nSel = (o.selectors || []).length;
    const nTxt = (o.texts || []).length;
    const nEx  = (o.ex || []).length;
    const bytes = (SITE_PREFIX + host).length + JSON.stringify(o).length;
    const tags = [];
    if (nSel) tags.push(`숨긴 항목 ${nSel}`);
    if (nEx)  tags.push(`예외 ${nEx}`);
    if (nTxt) tags.push(`텍스트 ${nTxt}`);
    if (o.nb === true) tags.push("기본규칙 끔");
    tags.push(`${bytes.toLocaleString()}B`);
    const badge = ` <span class="note">${tags.join(" · ")}</span>`;

    tr.innerHTML = `<td class="host">${esc(host)}${badge}</td>${cells}
      <td class="x"><button data-del="${escAttr(host)}"
        title="이 사이트 항목을 지웁니다" aria-label="사이트 삭제">✕</button></td>`;
    body.appendChild(tr);

    for (const f of FEATURES) {
      const sel = tr.querySelector(`select[data-key="${f.key}"]`);
      const v = o[f.key];
      sel.value = typeof v === "boolean" ? String(v) : "";
      if (typeof v === "boolean") sel.classList.add("set");
    }

    const nbSel = tr.querySelector("select[data-nbhost]");
    nbSel.value = o.nb === true ? "true" : "";
    if (o.nb === true) nbSel.classList.add("off");
  }

  body.querySelectorAll("select[data-host]").forEach((sel) => {
    sel.addEventListener("change", async () => {
      const { host, key } = sel.dataset;
      const c = await read();
      const site = { ...(c.sites[host] || {}) };

      if (sel.value === "") delete site[key];
      else site[key] = sel.value === "true";

      if (!(await writeSites({ ...c.sites, [host]: site }, c.sites))) { refresh(); return; }
      say(`${host} 설정을 저장했습니다.`);
      refresh();
    });
  });

  body.querySelectorAll("select[data-nbhost]").forEach((sel) => {
    sel.addEventListener("change", async () => {
      const host = sel.dataset.nbhost;
      const c = await read();
      const site = { ...(c.sites[host] || {}) };

      if (sel.value === "true") site.nb = true;
      else delete site.nb;

      if (!(await writeSites({ ...c.sites, [host]: site }, c.sites))) { refresh(); return; }
      say(sel.value === "true"
        ? `${host} 에서 기본 규칙을 끕니다.`
        : `${host} 에서 기본 규칙을 다시 씁니다.`);
      refresh();
    });
  });

  body.querySelectorAll("button[data-del]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const host = btn.dataset.del;
      const c = await read();
      const nSel = (c.sites[host]?.selectors || []).length;
      const nTxt = (c.sites[host]?.texts || []).length;
      const nEx  = (c.sites[host]?.ex || []).length;
      if (nSel + nTxt + nEx) {
        const parts = [];
        if (nSel) parts.push(`숨긴 항목 ${nSel}건`);
        if (nEx)  parts.push(`예외 ${nEx}건`);
        if (nTxt) parts.push(`텍스트 규칙 ${nTxt}건`);
        if (!confirm(`${host}의 ${parts.join(", ")}도 함께 삭제됩니다. 계속할까요?`)) return;
      } else if (!confirm(`${host} 항목을 삭제할까요?`)) return;

      const next = { ...c.sites };
      delete next[host];
      if (!(await writeSites(next, c.sites))) return;
      say(`${host} 항목을 삭제했습니다.`);
      refresh();
    });
  });
}

// 세 목록의 사이트 묶음 머리. "모든 사이트" 보기에서는 이 줄만 남는다 (D064)
function groupHead(host, n) {
  return `<div><a href="#${encodeURIComponent(host)}">${esc(host)}</a> <span class="note">· ${n}개</span></div>`;
}

/* ---------- 내가 숨긴 요소 ---------- */
function renderSelectors(conf) {
  const box = $("selbox");
  if (!box) return;
  box.textContent = "";

  const sites = conf.sites || {};
  const hosts = Object.keys(sites)
    .filter((h) => (sites[h].selectors || []).length)
    .sort();

  if (!hosts.length) {
    box.innerHTML = `<div class="empty">직접 숨긴 항목이 없습니다. ` +
      `팝업에서 진단 모드를 켠 뒤 "골라 숨기기"로 추가하거나 위 칸에 직접 넣으십시오.</div>`;
    return;
  }

  for (const host of hosts) {
    const div = document.createElement("div");
    div.dataset.host = host;

    let items = "";
    sites[host].selectors.forEach((sel, i) => {
      // 무엇을 지우는 단추인지 글자로 밝힌다. 가위표만 두면 바로 앞에 놓인
      // 것을 지우는 단추로 읽힌다(i-5-E).
      // 값을 함께 실어 두는 이유: 삭제는 인덱스로 하는데, 저장소 변경 갱신이
      // 120ms 로 묶여 있어 다른 탭이 목록을 건드리면 화면의 인덱스가 실제
      // 배열과 어긋난다. 누를 때 한 번 대조한다(i-5-D).
      items += `<li><code>${esc(sel)}</code>
        <button data-h="${escAttr(host)}" data-i="${i}" data-sval="${escAttr(sel)}"
                title="이 선택자를 지웁니다" aria-label="선택자 삭제">선택자 삭제 ✕</button></li>`;
    });

    div.innerHTML =
      groupHead(host, sites[host].selectors.length) +
      `<ul class="sel">${items}</ul>`;
    box.appendChild(div);
  }

  box.querySelectorAll("button[data-sval]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const h = btn.dataset.h;
      const i = Number(btn.dataset.i);
      if (!confirm(`${h} 의 선택자를 삭제할까요?\n\n${btn.dataset.sval}`)) return;
      const c = await read();
      const site = { ...(c.sites[h] || {}) };
      const list = (site.selectors || []).slice();

      if (list[i] !== btn.dataset.sval) {
        say("목록이 바뀌었습니다. 다시 확인하고 눌러 주십시오.", true);
        refresh();
        return;
      }

      const gone = list[i];
      list.splice(i, 1);

      if (list.length) site.selectors = list;
      else delete site.selectors;

      if (!(await writeSites({ ...c.sites, [h]: site }, c.sites))) return;
      say(`${h} 의 선택자를 삭제했습니다. ${gone} (${list.length}건 남음)`);
      refresh();
    });
  });
}

/* ---------- 기본 규칙 예외 ---------- */
function renderEx(conf) {
  const box = $("exbox");
  if (!box) return;
  box.textContent = "";

  const sites = conf.sites || {};
  const hosts = Object.keys(sites)
    .filter((h) => (sites[h].ex || []).length)
    .sort();

  if (!hosts.length) {
    box.innerHTML = `<div class="empty">등록된 예외가 없습니다. ` +
      `기본 규칙이 광고 아닌 요소를 숨길 때 그 선택자를 예외로 추가하세요.</div>`;
    return;
  }

  for (const host of hosts) {
    const div = document.createElement("div");
    div.dataset.host = host;

    let items = "";
    sites[host].ex.forEach((sel, i) => {
      items += `<li><code>${esc(sel)}</code>
        <button data-eh="${escAttr(host)}" data-ei="${i}" data-eval="${escAttr(sel)}"
                title="이 예외를 지웁니다" aria-label="예외 삭제">예외 삭제 ✕</button></li>`;
    });

    div.innerHTML =
      groupHead(host, sites[host].ex.length) +
      `<ul class="sel">${items}</ul>`;
    box.appendChild(div);
  }

  box.querySelectorAll("button[data-eval]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const h = btn.dataset.eh;
      const i = Number(btn.dataset.ei);
      if (!confirm(`${h} 의 예외를 삭제할까요?\n\n${btn.dataset.eval}`)) return;
      const c = await read();
      const site = { ...(c.sites[h] || {}) };
      const list = (site.ex || []).slice();

      if (list[i] !== btn.dataset.eval) {
        say("목록이 바뀌었습니다. 다시 확인하고 눌러 주십시오.", true);
        refresh();
        return;
      }

      const gone = list[i];
      list.splice(i, 1);

      if (list.length) site.ex = list;
      else delete site.ex;

      if (!(await writeSites({ ...c.sites, [h]: site }, c.sites))) return;
      say(`${h} 의 예외를 삭제했습니다. ${gone} (${list.length}건 남음)`);
      refresh();
    });
  });
}

function renderTexts(conf) {
  const sites = conf.sites || {};
  const box = $("textbox");
  if (!box) return;
  box.textContent = "";

  const hosts = Object.keys(sites)
    .filter((h) => (sites[h].texts || []).length)
    .sort();

  if (!hosts.length) {
    box.innerHTML = `<div class="empty">등록된 텍스트 규칙이 없습니다. ` +
      `위 칸에 사이트와 낱말을 넣어 추가하십시오.</div>`;
    return;
  }

  for (const host of hosts) {
    const div = document.createElement("div");
    div.dataset.host = host;

    let items = "";
    sites[host].texts.forEach((r, i) => {
      const scope = r.scope || "div";
      const mode = modeOf(r);
      // 완전 일치에서는 제외 단어가 아무 일도 하지 않는다. content.js 도
      // 무시하므로 목록에도 적지 않는다.
      const not = (mode !== "eq" && Array.isArray(r.not))
        ? r.not.filter((s) => typeof s === "string" && s.trim())
        : [];
      const tail = not.length
        ? ` <span class="note">단</span> ` +
          not.map((s) => `<span class="xword">${esc(s)}</span>`)
             .join(`<span class="note">,</span> `) +
          ` <span class="note">제외</span>`
        : "";

      // 제외 단어가 붙으면서 줄 끝이 길어졌다. 예전처럼 ✕ 만 두면 그것이
      // 제외 단어를 지우는 단추로 읽힌다. 실제로 그렇게 오해한 사례가 있다.
      // 무엇을 지우는 단추인지 글자로 밝히고, 제외 단어만 고치는 경로도 적는다.
      // scope·word 를 함께 실어 두는 이유는 selectors·ex 쪽과 같다(i-5-D).
      // 일치 방식은 대조에 쓰지 않는다. 중복 판정 키가 범위·낱말이고 방식은
      // 그 키에 딸린 값이어서, 같은 범위·낱말로 다시 추가하면 교체된다.
      items += `<li><code>${esc(scope)}</code>
        <span class="note">${MODE_PRE[mode]}</span>
        <span class="word">${esc(r.word)}</span>
        <span class="note">${MODE_POST[mode]}</span>${tail}
        <button class="rule-del" data-th="${escAttr(host)}" data-ti="${i}"
                data-tscope="${escAttr(scope)}" data-tword="${escAttr(r.word)}"
                title="이 규칙을 지웁니다. 일치 방식이나 제외 단어만 고치려면 같은 범위·낱말로 다시 추가하십시오."
                aria-label="규칙 삭제">규칙 삭제 ✕</button></li>`;
    });

    div.innerHTML =
      groupHead(host, sites[host].texts.length) +
      `<ul class="sel">${items}</ul>`;
    box.appendChild(div);
  }

  box.querySelectorAll("button[data-th]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const h = btn.dataset.th;
      const i = Number(btn.dataset.ti);
      if (!confirm(`${h} 의 텍스트 규칙을 삭제할까요?\n\n${btn.dataset.tscope} · ${btn.dataset.tword}`)) return;
      const c = await read();
      const site = { ...(c.sites[h] || {}) };
      const list = (site.texts || []).slice();
      const cur = list[i];

      // 화면과 저장소가 어긋났으면 지우지 않고 다시 그린다
      if (!cur || (cur.scope || "div") !== btn.dataset.tscope ||
          cur.word !== btn.dataset.tword) {
        say("목록이 바뀌었습니다. 다시 확인하고 눌러 주십시오.", true);
        refresh();
        return;
      }

      list.splice(i, 1);
      if (list.length) site.texts = list;
      else delete site.texts;

      if (!(await writeSites({ ...c.sites, [h]: site }, c.sites))) return;

      // 무엇이 사라졌는지 밝힌다. 잘못 눌렀을 때 그 자리에서 알 수 있어야 한다.
      const m = modeOf(cur);
      const gone = (m !== "eq" && Array.isArray(cur.not))
        ? cur.not.filter((s) => s && s.trim()) : [];
      const tail = gone.length ? ` 단 「${gone.join("」, 「")}」 제외` : "";
      say(`${h} 의 규칙을 삭제했습니다. ` +
          `${cur.scope || "div"} ${MODE_PRE[m]} 「${cur.word}」 ` +
          `${MODE_POST[m]}${tail}. (${list.length}건 남음)`);
      refresh();
    });
  });
}

/* ---------- 저장 공간 ---------- */
// storage.local 에는 항목당·항목 수 한도가 없어 전체 바이트만 한도다 (D021)
async function renderQuota() {
  const el = $("quota");
  if (!el || typeof chrome.storage.local.getBytesInUse !== "function") return;

  let total;
  try { total = await chrome.storage.local.getBytesInUse(null); } catch { return; }

  const MAX_ALL = chrome.storage.local.QUOTA_BYTES || 10485760;

  const all = await getAll();
  const keys = Object.keys(all).filter((k) => k.startsWith(SITE_PREFIX));

  const pct = (total / MAX_ALL) * 100;
  const shown = pct > 0 && pct < 1 ? "1% 미만" : pct.toFixed(1) + "%";
  // 1MB 미만은 KB, 이상은 MB. 소수 한 자리, 끝의 .0 은 뺀다 (D067)
  const size = (n) => n < 1048576 ? `${+(n / 1024).toFixed(1)}KB` : `${+(n / 1048576).toFixed(1)}MB`;

  let line = `${size(total)} / ${size(MAX_ALL)} 사용 (${shown}) · 사이트 ${keys.length}개`;

  // 배경이 storage.sync 의 옛 설정을 옮기다 실패했으면 알린다. 다음 실행 때 다시 시도한다
  const { copyErr } = await chrome.storage.session.get("copyErr").catch(() => ({}));
  if (copyErr) line += ` · 이전 설정(storage.sync)을 옮기지 못했습니다: ${copyErr}. 브라우저를 다시 시작하면 다시 시도합니다`;

  // 구분점만 따로 칸에 넣어 양옆 여백을 CSS 로 넓힌다. 글자 내용은 그대로 (D068)
  el.replaceChildren(...line.split(" · ").flatMap((t, i) => {
    if (!i) return [t];
    const sep = document.createElement("span");
    sep.className = "sep";
    sep.textContent = "·";
    return [" ", sep, " " + t];
  }));
  // 색은 options.html 의 변수를 쓴다
  el.style.color = (pct >= 80 || copyErr) ? "var(--danger)" : "var(--muted)";
}

/* ---------- 사이트 목록과 보기 거르기 (D035, D048) ---------- */
// 왼쪽 목록에서 고른 사이트는 주소 #호스트 로 남는다. 비어 있으면 모든 사이트
function currentHost() {
  try { return decodeURIComponent(location.hash.slice(1)); } catch { return ""; }
}

function renderNav(conf) {
  const nav = $("siteNav");
  if (!nav) return;
  const sites = conf.sites || {};
  const hosts = Object.keys(sites).sort();
  let html = `<a href="#" data-all><span class="h">모든 사이트</span><span class="note">${hosts.length}</span></a>`;
  for (const h of hosts) {
    const o = sites[h] || {};
    // 출처 색 점: 숨긴 요소·예외·텍스트 규칙이 있으면 하나씩
    const pips = [["selectors", "p-custom"], ["ex", "p-ex"], ["texts", "p-text"]]
      .filter(([k]) => (o[k] || []).length).map(([, c]) => `<i class="${c}"></i>`).join("");
    html += `<a href="#${encodeURIComponent(h)}" data-host="${escAttr(h)}">` +
            `<span class="h">${esc(h)}</span><span class="pips">${pips}</span></a>`;
  }
  nav.innerHTML = html;
}

// 고른 사이트와 찾기칸으로 이미 그린 목록을 감추기만 한다. 다시 그리지 않으므로
// 삭제 단추의 값 대조(i-5-D)는 그대로다
function applyView() {
  const cur = currentHost();
  const q = ($("find")?.value || "").trim().toLowerCase();
  const hostHit = (h) => !q || h.toLowerCase().includes(q);
  const sum = !cur && !q;   // 모든 사이트에 찾기 없음: 사이트마다 머리 한 줄만 (D064)

  // 찾기에 맞는 줄이 있는 사이트
  const found = new Set();
  for (const g of document.querySelectorAll("#selbox > div[data-host], #exbox > div[data-host], #textbox > div[data-host]")) {
    const h = g.dataset.host;
    let any = false;
    for (const li of g.querySelectorAll("li")) {
      const ok = hostHit(h) || li.textContent.toLowerCase().includes(q);
      li.hidden = !ok;
      any = any || ok;
    }
    if (any) found.add(h);
    g.querySelector("ul.sel").hidden = sum;
    g.hidden = !any || (!!cur && h !== cur);
  }
  const match = (h) => hostHit(h) || found.has(h);
  for (const tr of document.querySelectorAll("#sbody > tr[data-host]")) {
    tr.hidden = (!!cur && tr.dataset.host !== cur) || !match(tr.dataset.host);
  }
  for (const a of document.querySelectorAll("#siteNav a")) {
    const h = a.dataset.host;
    if (h !== undefined) a.hidden = !match(h);
    if ((h ?? "") === cur) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
  for (const id of ["gcard", "ggrp"]) if ($(id)) $(id).hidden = !!cur;
  if ($("viewTitle")) $("viewTitle").textContent = cur || "모든 사이트";
}

// 사이트를 고르면 추가 폼의 사이트 칸을 채운다. refresh 에서는 하지 않는다(입력이 튐, i-5-E)
function fillHosts() {
  const cur = currentHost();
  if (!cur) return;
  for (const id of ["nHost", "xHost", "tHost"]) if ($(id)) $(id).value = cur;
}

window.addEventListener("hashchange", () => { fillHosts(); applyView(); });
on("find", "input", applyView);

async function refresh() {
  buildHead();
  const conf = await read();
  renderGlobal(conf);
  renderHostList(conf);
  renderSites(conf);
  renderSelectors(conf);
  renderEx(conf);
  renderTexts(conf);
  renderNav(conf);
  applyView();
  renderQuota();
}

/* ---------- 추가 폼 ---------- */
// 사이트 추가. 배너 숨기기만 전체 기본값을 따라 넣는다. 나머지 기능은
// 값을 넣지 않아 "기본값 따름" 으로 남는다.
async function addSite() {
  const hEl = $("sHost");
  const h = readHost(hEl);
  if (!h) return;

  const c = await read();
  if (c.sites[h]) {
    say(`${h} 항목이 이미 있습니다.`, true);
    if (hEl) { hEl.focus(); hEl.select(); }
    return;
  }

  if (!(await writeSites({ ...c.sites, [h]: { banner: c.global.banner } }, c.sites))) return;

  if (hEl) { hEl.value = ""; hEl.focus(); }
  say(`${h} 항목을 추가했습니다. 배너 숨기기는 전체 기본값(` +
      `${c.global.banner ? "ON" : "OFF"})을 따릅니다.`);
  refresh();
}

// 내가 숨긴 요소에 직접 추가.
async function addSelRule() {
  const hEl = $("nHost"), sEl = $("nSel");
  const h = readHost(hEl);
  if (!h) return;
  const sel = readSelector(sEl, "숨길 CSS 선택자");
  if (!sel) return;

  const c = await read();
  const site = { ...(c.sites[h] || {}) };
  const list = (site.selectors || []).slice();
  if (list.includes(sel)) {
    say("이미 등록된 선택자입니다.", true);
    if (sEl) { sEl.focus(); sEl.select(); }
    return;
  }
  list.push(sel);
  site.selectors = list;

  if (!(await writeSites({ ...c.sites, [h]: site }, c.sites))) return;

  // 호스트는 남겨 둔다. 한 사이트에 여러 건을 넣는 일이 잦다.
  if (hEl) hEl.value = h;               // 정규화 결과를 눈으로 확인시킨다
  if (sEl) { sEl.value = ""; sEl.focus(); }

  // 이 페이지는 특정 탭에 속하지 않아 실제 적용 건수를 셀 수 없다.
  // 확인은 팝업의 규칙별 적용 상태에서 한다.
  say(`${h} 에 선택자를 추가했습니다. ${sel} (${list.length}건)`);
  refresh();
}

// 기본 규칙 예외에 직접 추가.
async function addExRule() {
  const hEl = $("xHost"), sEl = $("xSel");
  const h = readHost(hEl);
  if (!h) return;
  const sel = readSelector(sEl, "제외할 CSS 선택자");
  if (!sel) return;

  const c = await read();
  const site = { ...(c.sites[h] || {}) };
  const list = (site.ex || []).slice();
  if (list.includes(sel)) {
    say("이미 등록된 예외입니다.", true);
    if (sEl) { sEl.focus(); sEl.select(); }
    return;
  }
  list.push(sel);
  site.ex = list;

  if (!(await writeSites({ ...c.sites, [h]: site }, c.sites))) return;

  if (hEl) hEl.value = h;
  if (sEl) { sEl.value = ""; sEl.focus(); }

  // 예외가 셋을 넘으면 기본 규칙을 끄는 편이 간단하다(i-6-A).
  const advise = list.length > 3
    ? " 예외가 세 개를 넘었습니다. 이 사이트의 기본규칙을 끄는 편이 낫습니다."
    : "";
  say(`${h} 에 예외를 추가했습니다. ${sel} (${list.length}건)${advise}`);
  refresh();
}

// 텍스트 규칙 추가. 입력은 폼 칸에서 읽고 결과는 토스트로 알린다.
// 실패하면 문제가 있는 칸으로 포커스를 보낸다. 예전 prompt 경로는 이 페이지가
// 활성 탭이 아닐 때 null 을 받아 조용히 버려졌다.
//
// 같은 범위·낱말 규칙이 이미 있으면 거절하지 않고 일치 방식과 제외 단어를 갈아
// 끼운다. 거절하면 등록해 둔 규칙의 방식이나 제외 단어를 고칠 경로가 아예
// 없어진다. 그래서 중복 판정 키는 범위·낱말뿐이고 방식은 키에 넣지 않는다.
async function addTextRule() {
  const hEl = $("tHost"), sEl = $("tScope"), wEl = $("tWord"),
        mEl = $("tMode"), nEl = $("tNot");
  if (!hEl || !wEl) return;

  const h = normHost(hEl.value);
  if (!h) {
    say("사이트 호스트를 입력하십시오. 예: example.com", true);
    hEl.focus(); return;
  }

  const scope = (sEl ? sEl.value : "").trim() || "div";
  try { document.querySelector(scope); }
  catch { say("범위 선택자 문법이 잘못되었습니다.", true); (sEl || hEl).focus(); return; }

  const mode = (mEl && (mEl.value === "eq" || mEl.value === "re")) ? mEl.value : "";

  const word = wEl.value.trim();
  if (!word) {
    say(mode === "re" ? "정규식을 입력하십시오." : "포함되어야 할 낱말을 입력하십시오.", true);
    wEl.focus(); return;
  }
  if (word.length < 2) { say("낱말은 두 글자 이상이어야 합니다.", true); wEl.focus(); return; }

  // 정규식은 저장 전에 컴파일해 본다. 문법이 틀린 것을 넣으면 content.js 의
  // textRules 가 조용히 버려, 규칙은 목록에 보이는데 아무것도 잡히지 않는다.
  // 빈 글자에 맞는 패턴은 반대로 모든 요소를 잡는다.
  if (mode === "re") {
    if (word.length > MAX_RE) {
      say(`정규식은 ${MAX_RE}자까지입니다. 범위를 좁히는 편이 낫습니다.`, true);
      wEl.focus(); wEl.select(); return;
    }
    let re;
    try { re = new RegExp(word, "i"); }
    catch (e) {
      say("정규식 문법이 잘못되었습니다: " + e.message, true);
      wEl.focus(); wEl.select(); return;
    }
    if (re.test("")) {
      say("빈 글자에도 맞는 정규식입니다. 이대로면 모든 요소가 걸립니다.", true);
      wEl.focus(); wEl.select(); return;
    }
    if (riskyRegex(word)) {
      say("위험한 정규식입니다. (a+)+ 처럼 반복 안에 반복이 있으면 페이지가 멈출 수 있습니다.", true);
      wEl.focus(); wEl.select(); return;
    }
  }

  // 제외 단어. 쉼표로 나누고 트림·중복 제거한다. 비면 키를 넣지 않는다.
  const not = [];
  for (const raw of (nEl ? nEl.value : "").split(",")) {
    const t = raw.trim();
    if (!t) continue;
    if (t.length < 2) {
      say("제외 단어도 두 글자 이상이어야 합니다.", true);
      if (nEl) { nEl.focus(); nEl.select(); }
      return;
    }
    if (t.toLowerCase() === word.toLowerCase()) {
      say("제외 단어가 낱말과 같으면 아무것도 잡히지 않습니다.", true);
      if (nEl) { nEl.focus(); nEl.select(); }
      return;
    }
    if (!not.some((s) => s.toLowerCase() === t.toLowerCase())) not.push(t);
  }
  if (not.length > MAX_NOT) {
    say(`제외 단어는 ${MAX_NOT}개까지입니다. 범위나 낱말을 좁히는 편이 낫습니다.`, true);
    if (nEl) nEl.focus();
    return;
  }

  // 완전 일치에서 제외 단어는 아무 일도 하지 않거나 규칙 전체를 죽인다. 글자
  // 전체가 낱말과 같아야 잡히므로, 제외 단어가 낱말의 일부이면 늘 막고 아니면
  // 한 번도 막지 않는다. 조용히 버리면 왜 안 잡히는지 알 수 없어 거절한다.
  if (mode === "eq" && not.length) {
    say("완전 일치에는 제외 단어를 쓸 수 없습니다. 칸을 비우거나 포함으로 바꾸십시오.", true);
    if (nEl) { nEl.focus(); nEl.select(); }
    return;
  }

  const c = await read();
  const site = { ...(c.sites[h] || {}) };
  const list = (site.texts || []).slice();

  const at = list.findIndex((r) => (r.scope || "div") === scope && r.word === word);
  const item = { scope, word };
  if (mode) item.m = mode;          // 포함은 키를 넣지 않는다
  if (not.length) item.not = not;

  let replaced = false;
  if (at >= 0) {
    const prev = list[at];
    const prevMode = modeOf(prev);
    const prevNot = Array.isArray(prev.not) ? prev.not : [];
    if (prevMode === mode && prevNot.length === not.length &&
        prevNot.every((s, i) => s === not[i])) {
      say("이미 등록된 규칙입니다.", true);
      wEl.focus(); wEl.select(); return;
    }
    list[at] = item;
    replaced = true;
  } else {
    list.push(item);
  }
  site.texts = list;

  if (!(await writeSites({ ...c.sites, [h]: site }, c.sites))) return;

  // 호스트와 범위, 일치 방식은 남겨 둔다. 같은 사이트에 같은 방식으로 낱말을
  // 여러 개 넣는 일이 잦다. 제외 단어는 낱말에 딸린 값이라 낱말과 함께 비운다.
  hEl.value = h;              // 정규화 결과를 눈으로 확인시킨다
  if (sEl) sEl.value = scope === "div" ? "" : scope;
  wEl.value = "";
  if (nEl) nEl.value = "";
  wEl.focus();

  const tail = not.length ? ` 단 「${not.join("」, 「")}」 제외.` : "";
  say(`${h} 에 규칙을 ${replaced ? "고쳤습니다" : "추가했습니다"}. ` +
      `${scope} ${MODE_PRE[mode]} 「${word}」 ${MODE_POST[mode]}.${tail} (${list.length}건)`);
  refresh();
}

on("siteForm", "submit", (e) => { e.preventDefault(); addSite(); });
on("selForm",  "submit", (e) => { e.preventDefault(); addSelRule(); });
on("exForm",   "submit", (e) => { e.preventDefault(); addExRule(); });
on("textForm", "submit", (e) => { e.preventDefault(); addTextRule(); });

/* ---------- 백업과 복구 ---------- */
// settings-backup-2026-09-16.json 꼴. 저장소의 .gitignore 가
// settings-backup*.json 을 무시하므로 작업 폴더에 받아도 커밋에 섞이지 않는다.
function backupName() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `settings-backup-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.json`;
}

// 파일 저장은 Blob 과 a[download] 로 한다. downloads 권한이 필요 없다.
on("saveFile", "click", async () => {
  const conf = await read();
  const text = JSON.stringify(
    { schema: SCHEMA, global: conf.global, sites: conf.sites }, null, 2);

  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = backupName();
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 내려받기가 시작된 뒤 주소를 놓아준다
  setTimeout(() => URL.revokeObjectURL(url), 2000);

  const n = Object.keys(conf.sites).length;
  say(`${a.download} 로 저장했습니다. 사이트 ${n}개.`);
});

on("loadFile", "click", () => {
  const el = $("file");
  if (el) el.click();
});

on("file", "change", async (e) => {
  const input = e.target;
  const f = input.files && input.files[0];
  // 같은 파일을 다시 고를 수 있게 값을 비운다. 안 비우면 change 가 안 난다.
  input.value = "";
  if (!f) return;

  if (f.size > MAX_FILE) {
    say("파일이 너무 큽니다. 설정 백업 파일인지 확인하십시오.", true);
    return;
  }

  let text;
  try { text = await f.text(); }
  catch (err) { say("파일을 읽지 못했습니다: " + err.message, true); return; }

  let parsed;
  try { parsed = JSON.parse(text); }
  catch (err) { say("JSON 형식이 잘못되었습니다: " + err.message, true); return; }

  await applyConf(parsed, f.name);
});

// 파일에서 읽은 설정을 검사하고 저장소에 반영한다.
// 알 수 없는 값은 버리고, 사라지는 것이 있으면 먼저 물어본다.
async function applyConf(parsed, fileName) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    say("설정 파일 형식이 아닙니다.", true);
    return;
  }

  const global = { ...DEFAULT_GLOBAL };
  for (const f of FEATURES) {
    const v = parsed.global?.[f.key];
    if (typeof v === "boolean") global[f.key] = v;
  }

  // 옛 형식({sites:{...}})과 새 형식(s: 키)을 모두 받아들인다
  const rawSites = {};
  if (parsed.sites && typeof parsed.sites === "object") {
    Object.assign(rawSites, parsed.sites);
  }
  for (const k of Object.keys(parsed)) {
    if (k.startsWith(SITE_PREFIX)) rawSites[k.slice(SITE_PREFIX.length)] = parsed[k];
  }

  if (parsed.global === undefined && !Object.keys(rawSites).length) {
    say("설정 내용을 찾지 못했습니다. global 과 sites 가 있어야 합니다.", true);
    return;
  }

  const sites = {};
  let selCount = 0, txtCount = 0, exCount = 0, nbCount = 0;
  let reCount = 0, reRisky = 0;

  for (const [rawHost, raw] of Object.entries(rawSites)) {
    const host = normHost(rawHost);
    if (!host || !raw || typeof raw !== "object") continue;

    const site = {};
    for (const f of FEATURES) {
      if (typeof raw[f.key] === "boolean") site[f.key] = raw[f.key];
    }

    // nb 는 true 일 때만 저장한다. false 는 기본 동작과 같아 넣을 필요가 없다.
    if (raw.nb === true) { site.nb = true; nbCount++; }

    if (Array.isArray(raw.ex)) {
      const list = raw.ex.filter((s) => typeof s === "string" && s.trim());
      if (list.length) { site.ex = list; exCount += list.length; }
    }

    if (Array.isArray(raw.selectors)) {
      const list = raw.selectors.filter((s) => typeof s === "string" && s.trim());
      if (list.length) { site.selectors = list; selCount += list.length; }
    }

    // 복구는 화이트리스트라 모르는 키를 버린다. m 과 not 을 여기서 받지 않으면
    // 파일을 되복구하는 것만으로 일치 방식과 제외 단어가 사라진다(i-5-B).
    if (Array.isArray(raw.texts)) {
      const list = [];
      for (const r of raw.texts) {
        if (!r || typeof r !== "object") continue;
        if (typeof r.word !== "string" || !r.word.trim()) continue;

        const o = {
          scope: (typeof r.scope === "string" && r.scope.trim()) ? r.scope.trim() : "div",
          word: r.word.trim()
        };

        // 일치 방식. 모르는 값은 포함으로 본다. 정규식은 여기서 컴파일해 보고
        // 문법이 틀리거나 빈 글자에 맞거나 너무 길면 규칙째 버린다. 남겨 두면
        // 목록에는 보이는데 아무것도 잡히지 않거나 전부 잡힌다.
        const m = modeOf(r);
        if (m === "re") {
          if (o.word.length > MAX_RE) continue;
          try { if (new RegExp(o.word, "i").test("")) continue; } catch { continue; }
          // 반복이 겹친 패턴은 버리되 미리보기에 따로 알린다 (D019)
          if (riskyRegex(o.word)) { reRisky++; continue; }
          reCount++;
        }
        if (m) o.m = m;

        // 제외 단어는 있을 때만 넣는다. 빈 배열을 저장하면 항목 크기만 늘고,
        // 손으로 고친 파일에서 문자열 하나만 넘어오는 경우도 받아들인다.
        // 완전 일치에서는 아무 일도 하지 않으므로 버린다.
        if (m !== "eq") {
          const src = Array.isArray(r.not) ? r.not
                    : (typeof r.not === "string" ? [r.not] : []);
          const not = [];
          for (const s of src) {
            if (typeof s !== "string") continue;
            const t = s.trim();
            if (!t) continue;
            if (t.toLowerCase() === o.word.toLowerCase()) continue;
            if (!not.some((v) => v.toLowerCase() === t.toLowerCase())) not.push(t);
          }
          if (not.length) o.not = not.slice(0, MAX_NOT);
        }

        list.push(o);
      }
      if (list.length) { site.texts = list; txtCount += list.length; }
    }

    if (hasContent(site)) sites[host] = site;
  }

  // 복구는 사이트 목록 전체를 갈아엎는 동작이다. 무엇이 사라지는지 먼저 센다.
  const cur = await read();
  const curHosts = Object.keys(cur.sites);
  const nextHosts = Object.keys(sites);
  const gone = curHosts.filter((h) => !hasContent(sites[h]));
  const changed = nextHosts.filter((h) => cur.sites[h] &&
    stable(cur.sites[h]) !== stable(sites[h]));
  const added = nextHosts.filter((h) => !cur.sites[h]);

  const parts = [];
  if (added.length)   parts.push(`추가 ${added.length}개`);
  if (changed.length) parts.push(`교체 ${changed.length}개`);
  if (gone.length)    parts.push(`삭제 ${gone.length}개`);

  let ask = fileName ? `${fileName} 의 내용으로 설정을 바꿉니다.\n\n`
                     : `설정을 바꿉니다.\n\n`;
  ask += parts.length ? parts.join(" · ") : "사이트 설정 변경 없음";
  if (reRisky) ask += `\n정규식 규칙 ${reCount}개 포함, 위험 패턴 ${reRisky}개 버림`;
  ask += `\n`;
  if (gone.length) {
    const head = gone.slice(0, 5).join(", ");
    const more = gone.length > 5 ? ` 외 ${gone.length - 5}개` : "";
    ask += `\n삭제될 사이트: ${head}${more}\n`;
  }
  ask += `\n계속할까요?`;
  if (!confirm(ask)) { say("복구를 취소했습니다."); return; }

  if (!(await write({ global }))) return;
  if (!(await writeSites(sites, cur.sites, { prune: true }))) return;
  say(`복구했습니다. 사이트 ${nextHosts.length}개, ` +
      `숨긴 항목 ${selCount}건, 예외 ${exCount}건, ` +
      `텍스트 규칙 ${txtCount}건, 기본규칙 끔 ${nbCount}개.`);
  refresh();
}

on("clearSites", "click", async () => {
  if (!confirm("사이트별 설정과 숨긴 항목, 예외, 텍스트 규칙을 모두 삭제합니다. 전체 기본값은 유지됩니다.")) return;
  if (!(await writeSites({}, null, { prune: true }))) return;
  say("사이트별 설정을 삭제했습니다.");
  refresh();
});

on("reset", "click", async () => {
  if (!confirm("전체 기본값까지 초기 상태로 되돌립니다.")) return;
  if (!(await write({ global: { ...DEFAULT_GLOBAL } }))) return;
  if (!(await writeSites({}, null, { prune: true }))) return;
  say("모든 설정을 초기화했습니다.");
  refresh();
});

// 팝업이나 요소 선택기로 설정이 바뀌면 열려 있는 이 페이지도 즉시 갱신.
// 한 번의 조작이 set 과 remove 두 번의 변경을 내므로 살짝 묶어서 그린다.
let refreshTimer;
chrome.storage.onChanged.addListener((_c, area) => {
  if (area !== "local") return;
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refresh, 120);
});

hideMsg();
fillHosts();
refresh();
