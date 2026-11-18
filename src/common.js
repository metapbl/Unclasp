// 배경·콘텐츠·팝업·옵션이 함께 쓰는 상수와 판정 함수.
// 콘텐츠 스크립트는 executeScript 로 같은 탭에 다시 주입될 수 있으므로,
// 두 번 읽혀도 재선언 오류가 나지 않게 const 대신 var 와 함수 선언으로 둔다.
/* exported SITE_PREFIX, FLAG_KEYS, DEFAULT_GLOBAL, FEATURES, hostFromUrl, hasContent, stable, riskyRegex, askTab, reach */

// v1.8 저장 구조: 사이트마다 s:<host> 항목을 따로 쓴다
var SITE_PREFIX = "s:";
var FLAG_KEYS = ["adblock", "banner", "rightclick", "copy", "back"];
var DEFAULT_GLOBAL = { adblock: true, banner: true, rightclick: false, copy: false, back: true };

// 팝업·옵션의 기능 줄. short 는 옵션 표 머리에만 쓴다. 광고 차단이 맨 위 (D089)
var FEATURES = [
  { key: "adblock",    label: "광고 차단",           short: "광고" },
  { key: "banner",     label: "배너 숨기기",         short: "배너" },
  { key: "rightclick", label: "우클릭 방지 해제",     short: "우클릭" },
  { key: "copy",       label: "복사 방지 해제",       short: "복사" },
  { key: "back",       label: "백스페이스 뒤로가기",   short: "백스페이스" }
];

// chrome://extensions 는 hostname 이 "extensions" 로 잡힌다.
// 저장 키는 http/https 호스트로만 만든다 (R§4 T4).
function hostFromUrl(url) {
  if (!url) return "";
  try {
    const u = new URL(url);
    return (u.protocol === "http:" || u.protocol === "https:") ? u.hostname : "";
  } catch {
    return "";
  }
}

// 쓸 만한 문자열이 하나라도 든 배열인지
function hasStr(v) {
  return Array.isArray(v) && v.some((s) => typeof s === "string" && s.trim());
}

// 사이트 항목에 의미 있는 내용이 남아 있는지. 비면 항목을 지운다.
// 값이 있기만 하면 인정하던 예전 기준은 손으로 고친 파일이나 옛 버전이 남긴
// 껍데기를 계속 살려 두어 항목 수만 잡아먹었다.
//  - 기능 플래그는 boolean 일 때만 내용으로 본다
//  - nb 는 true 만 내용이다. false 는 기본 동작과 같아 저장할 이유가 없다
//  - 배열은 길이가 아니라 쓸 만한 항목이 있는지로 본다. [""] 는 빈 것이다
//  - texts 는 word 가 실제로 있는 규칙이 하나라도 있어야 한다
// ex(기본 규칙 예외)·nb(기본 규칙 끄기)를 빼먹으면 플래그가 없는 사이트에서
// 키가 삭제돼 설정이 사라진다.
function hasContent(site) {
  if (!site || typeof site !== "object") return false;
  for (const k of FLAG_KEYS) if (typeof site[k] === "boolean") return true;
  if (site.nb === true) return true;
  if (hasStr(site.ex)) return true;
  if (hasStr(site.selectors)) return true;
  return Array.isArray(site.texts) && site.texts.some(
    (r) => r && typeof r === "object" &&
           typeof r.word === "string" && r.word.trim().length > 0);
}

// 반복이 겹친 정규식인지 (D019). (a+)+ 처럼 반복 기호(+, *, {n,})가 붙은 묶음 안에 다시
// 반복 기호가 있으면 맞지 않는 글자에서 시도가 지수적으로 늘어 페이지가 멈출 수 있다.
// 묶음마다 안에 반복이 있었는지 쌓아 두고, 닫는 괄호 뒤에 반복 기호가 오면 위험으로 본다.
// 이스케이프와 문자 집합 [...] 안의 기호는 반복이 아니다. ? 와 {n}·{n,m} 은 상한이 있어 보지 않는다.
function riskyRegex(src) {
  const open = [];      // 열린 묶음마다 안에 반복이 있었는지
  let inner = false;    // 방금 닫은 묶음 안에 반복이 있었는지
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const rep = c === "+" || c === "*" || (c === "{" && /^\{\d+,\}/.test(src.slice(i)));
    if (rep) {
      if (inner) return true;
      if (open.length) open[open.length - 1] = true;
    }
    inner = false;
    if (c === "\\") i++;
    else if (c === "[") { while (++i < src.length && src[i] !== "]") if (src[i] === "\\") i++; }
    else if (c === "(") open.push(false);
    else if (c === ")" && open.length) {
      inner = open.pop();
      if (inner && open.length) open[open.length - 1] = true;
    }
  }
  return false;
}

// 값이 같은지 볼 때 쓴다 (R§4 T3). JSON.stringify 를 그냥 쓰면 키 순서가 다른 것만으로
// 다른 값이 된다. 저장소에서 읽은 {not, scope, word} 와 복구 파서가 조립한
// {scope, word, not} 이 그 경우다. 키를 정렬해서 찍어 비교한다.
function stable(v) {
  return JSON.stringify(v, (_k, x) =>
    (x && typeof x === "object" && !Array.isArray(x))
      ? Object.keys(x).sort().reduce((a, n) => (a[n] = x[n], a), {})
      : x);
}

/* ---------- 탭의 콘텐츠 스크립트와 말하기 (팝업·배경) ---------- */
// 최상위 프레임에만 보낸다. 하위 프레임이 먼저 응답해 결과가 뒤바뀌는 일을 막는다. 실패하면 null
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

// 묻고, 응답이 없으면 주입한 뒤 다시 묻는다
async function reach(tabId, msg) {
  const res = await askTab(tabId, msg);
  if (res) return res;
  if (!(await injectContent(tabId))) return null;
  return await askTab(tabId, msg);
}
