(() => {
  if (window.__unclaspLoaded) return;   // 중복 주입 방지
  window.__unclaspLoaded = true;

  const HOST = location.hostname;

  const SITE_KEY = SITE_PREFIX + HOST;

  let state = {
    banner: true, rightclick: false, copy: false, back: true,
    diagnose: false, selectors: [], texts: [], ex: [], nb: false
  };

  /* ---------- 기본 선택자 ---------- */
  // 첫 줄의 class*="banner" 는 부분 문자열 검사라 광고가 아닌 UI 도 잡는다.
  // 웹 표준에서 role="banner" 는 사이트 헤더를 뜻하고, 네이버 검색은
  // 웨일 배너를 띄울 때 #header_wrap 에 type_whale_banner 를 붙인다.
  // 컨테이너를 통째로 숨기는 사고를 막기 위해, 입력 폼이나 랜드마크를
  // 품은 요소와 헤더성 id 를 제외한다. 광고 배너는 링크와 이미지로 이뤄지고
  // 검색창이나 nav, main 을 품지 않는다.
  const LANDMARK =
    "form, input, select, textarea, nav, main, header, footer, aside, article, h1";

  const BASE = [
    'div[class*="banner" i]' +
      ':not([class*="bannerless" i]):not([class*="main-banner" i]):not([class*="banner-info" i])' +
      ':not([role="banner"])' +
      ':not([id*="header" i]):not([id*="footer" i]):not([id*="gnb" i]):not([id*="lnb" i])' +
      `:not(:has(${LANDMARK}))`,
    '[class*="ad-banner" i]', '[id*="ad-banner" i]',
    '[class*="advertisement" i]', '[id*="advertisement" i]',
    '[class*="promotion-banner" i]', '[class*="promo-banner" i]',
    '[class*="sponsor" i]:not([class*="sponsorship-info" i]):not([class*="sponsor-name" i])',
    'ins.adsbygoogle',
    'iframe[src*="doubleclick"]',
    'iframe[src*="googlesyndication"]',
    'div:has(> iframe[src*="doubleclick"])',
    'div:has(> iframe[src*="googlesyndication"])',
    'div:has(> ins.adsbygoogle)'
  ];

  const BASE_SEL = BASE.join(",");
  const TEXTHIT  = "__uc_texthit";   // 진단 표시에만 붙인다
  const TEXT_MAX = 200;   // 이 글자 수를 넘으면 본문으로 보고 제외한다

  // 진단 모드 출처 표시용. 클래스와 속성 변경은 attributes 를 켜지 않은
  // MutationObserver 에 잡히지 않으므로 되먹임이 없다.
  const SRC_BASE   = "__uc_src_base";
  const SRC_CUSTOM = "__uc_src_custom";
  const SRC_EX     = "__uc_src_ex";
  const WILL       = "__uc_will_collapse";
  const REL        = "__uc_rel";
  const WHY        = "data-uc-why";
  const MARK_MAX   = 400;   // 표시 상한. 폭주 방지

  // 한 요소에 출처 클래스는 하나만 남긴다. 숫자가 클수록 우선한다.
  // 접힘 예정 < 예외로 유지 < 기본 규칙 < 내 규칙 < 텍스트 규칙
  const SRC_RANK = {
    [WILL]: 1, [SRC_EX]: 2, [SRC_BASE]: 3, [SRC_CUSTOM]: 4, [TEXTHIT]: 5
  };

  function isValid(sel) {
    try { document.querySelector(sel); return true; } catch { return false; }
  }

  /* ---------- 스타일 ---------- */
  // 평소 숨김은 페이지 DOM 에 흔적을 남기지 않는다 (D044). Firefox·토르는 배경이 사용자 시트로
  // 넣고, Chrome 은 호스트 권한 없이는 그것이 거부돼 adoptedStyleSheets 로 둔다. 요소 단위인
  // 텍스트 규칙·접기는 클래스 대신 문서 뿌리부터의 자리 선택자를 넣는다.
  const GECKO = chrome.runtime.getURL("").startsWith("moz-extension:");
  let quiet = null;         // Chrome 의 평소 시트
  let quietCss = "";        // 마지막으로 넣은 글자
  let cssChain = Promise.resolve();

  function applyQuiet(css) {
    if (css === quietCss) { keepAdopted(); return; }
    const old = quietCss;
    quietCss = css;
    if (GECKO) {
      // 넣기와 지우기가 엇갈리면 옛 시트가 남는다. 하나씩 보낸다
      cssChain = cssChain.then(() => chrome.runtime.sendMessage({ type: "CSS", css, old })).catch(() => {});
      return;
    }
    quiet ??= new CSSStyleSheet();
    quiet.replaceSync(css);
    keepAdopted();
  }

  // 페이지가 배열을 다시 대입하면 빠지므로 칠할 때마다 확인한다. 넣을 것이 없으면 뺀다
  function keepAdopted() {
    if (!quiet) return;
    const list = document.adoptedStyleSheets;
    const has = list.includes(quiet);
    if (quietCss && !has) document.adoptedStyleSheets = [...list, quiet];
    else if (!quietCss && has) document.adoptedStyleSheets = list.filter((s) => s !== quiet);
  }

  // 요소의 자리를 문서 뿌리부터 적은 선택자. DOM 이 바뀌면 다시 만들어야 한다
  function pathOf(el) {
    let p = "";
    for (; el.parentElement; el = el.parentElement) {
      let i = 1;
      for (let s = el.previousElementSibling; s; s = s.previousElementSibling) i++;
      p = `>*:nth-child(${i})` + p;
    }
    return ":root" + p;
  }

  const FOLD_CSS =
    `{min-height:0 !important;height:0 !important;` +
    `padding-top:0 !important;padding-bottom:0 !important;` +
    `margin-top:0 !important;margin-bottom:0 !important;` +
    `border-width:0 !important;overflow:hidden !important;}`;

  const COPY_CSS =
    `*,*::before,*::after{
       user-select:text !important;
       -webkit-user-select:text !important;
       -moz-user-select:text !important;
       -webkit-touch-callout:default !important;
     }`;

  // 진단 표시는 출처 표시 시트 하나로 통일한다. 예전에는 실제 규칙 문자열로
  // 빨간 테두리를 칠하는 시트가 따로 있었는데, 클래스 여러 개짜리 선택자가
  // 클래스 하나짜리 출처 클래스보다 특이도가 높아 내 규칙의 파란색이
  // 나오지 않았다. 두 시트가 같은 요소를 두고 경쟁하던 구조를 없앤다.
  // 진단을 켠 동안에만 문서에 둔다.
  //
  // 텍스트 규칙은 CSS 규칙과 구분되도록 주황색으로 표시한다.
  // 규칙 출처. 아래로 갈수록 우선한다.
  // 접힘 예정 < 기본 규칙 < 예외로 유지 < 내 규칙 < 텍스트 규칙
  // max-width 를 요소 폭에 묶지 않는다. ins 처럼 인라인이거나 좁은 배너에서
  // 배지가 "기본 규..." 로 잘려 읽을 수 없었다.
  const DIAG_CSS = `
    .${TEXTHIT}{
      outline:2px dashed #e67e22 !important;
      outline-offset:-2px !important;
      background:rgba(230,126,34,.12) !important;
    }
    .${REL}{position:relative !important;}
    [${WHY}]::after{
      content:attr(${WHY});
      position:absolute;top:0;left:0;z-index:2147483640;
      max-width:60vw;box-sizing:border-box;
      font:11px/1.45 ui-monospace,Consolas,monospace;
      color:#fff;background:#333;padding:1px 5px;border-radius:0 0 3px 0;
      white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
      pointer-events:none;
    }
    .${WILL}{outline:2px dotted #7f8c8d !important;outline-offset:-2px !important;
             background:rgba(127,140,141,.10) !important;}
    .${WILL}[${WHY}]::after{background:#7f8c8d;}
    .${SRC_BASE}{outline:2px dashed #e74c3c !important;outline-offset:-2px !important;
                 background:rgba(231,76,60,.10) !important;}
    .${SRC_BASE}[${WHY}]::after{background:#e74c3c;}
    .${SRC_EX}{outline:2px solid #27ae60 !important;outline-offset:-2px !important;
               background:rgba(39,174,96,.08) !important;}
    .${SRC_EX}[${WHY}]::after{background:#27ae60;}
    .${SRC_CUSTOM}{outline:2px dashed #2d7ff9 !important;outline-offset:-2px !important;
                   background:rgba(45,127,249,.12) !important;}
    .${SRC_CUSTOM}[${WHY}]::after{background:#2d7ff9;}
    .${TEXTHIT}[${WHY}]::after{background:#e67e22;}
  `;

  let sDiag = null;
  function diagStyle(on) {
    if (on && !sDiag) {
      sDiag = document.createElement("style");
      sDiag.id = "__uc_srcdiag__";
      sDiag.textContent = DIAG_CSS;
      (document.head || document.documentElement).appendChild(sDiag);
    } else if (!on && sDiag) {
      sDiag.remove();
      sDiag = null;
    }
  }

  let textHits = new Map();   // 텍스트 규칙에 걸린 요소 → 배지 문구 (가장 안쪽만, 문서 순서)
  let folded = [];            // 접은 요소

  /* ---------- 선택자 조립 ---------- */
  // ex 는 기본 선택자에만 적용한다. 사용자가 직접 등록한 selectors 는
  // 본인의 명시적 의사라 예외로 막지 않는다. 지우려면 팝업에서 삭제한다.
  function exSel() {
    return (state.ex || []).filter((s) => typeof s === "string" && s.trim() && isValid(s));
  }

  function exJoin() {
    const ex = exSel();
    return ex.length ? ex.join(",") : "";
  }

  // 예외 요소 자신과 그 자손을 기본 선택자에서 뺀다
  function guard() {
    const j = exJoin();
    if (!j) return "";
    const g = `:not(:is(${j})):not(:is(${j}) *)`;
    return isValid(`div${g}`) ? g : "";
  }

  function baseSel() {
    if (state.nb) return "";
    const g = guard();
    if (!g) return BASE_SEL;
    const joined = BASE.map((s) => s + g).join(",");
    return isValid(joined) ? joined : BASE_SEL;
  }

  function customSel() {
    return state.selectors.filter(isValid);
  }

  function allSel() {
    const parts = [];
    const b = baseSel();
    if (b) parts.push(b);
    const c = customSel();
    if (c.length) parts.push(c.join(","));
    return parts.join(",");
  }

  // 평소 시트의 글자를 만들어 넣는다. 진단 모드에서는 숨기지 않고 표시만 한다
  function paint() {
    const parts = [];
    if (state.banner && !state.diagnose) {
      const base = baseSel();
      const custom = customSel();
      if (base) parts.push(`${base}{display:none !important;}`);
      if (custom.length) parts.push(`${custom.join(",")}{display:none !important;}`);
      const text = [...textHits.keys()].filter((e) => e.isConnected).map(pathOf);
      if (text.length) parts.push(`${text.join(",")}{display:none !important;}`);
      const fold = folded.filter((e) => e.isConnected).map(pathOf);
      if (fold.length) parts.push(fold.join(",") + FOLD_CSS);
    }
    if (state.copy) parts.push(COPY_CSS);
    applyQuiet(parts.join("\n"));
  }

  function render() {
    diagStyle(state.diagnose);
    paint();
    markTexts();

    // 표시를 즉시 한 번 갱신한다. scheduleScan 만 두면 진단 모드를 켠 뒤
    // 200ms 동안 아무 표시도 없는 구간이 생긴다. 진단을 껐을 때는
    // markSources 가 clearMarks 만 하고 빠져나가므로 표시가 바로 사라진다.
    markSources();
    scheduleScan();
  }

  /* ---------- 텍스트 규칙 ---------- */
  const KEEP = new Set([
    "BODY", "HTML", "MAIN", "HEADER", "NAV", "FOOTER", "ARTICLE", "SECTION"
  ]);

  // 메뉴와 푸터는 "광고문의" 같은 링크 때문에 오탐이 잦다
  const TEXT_SKIP = "nav, footer";
  const MIN_W = 80;   // 이보다 작으면 배너로 보지 않는다
  const MIN_H = 30;

  // 일치 방식. 저장 값은 texts 원소의 m 키이고, 키가 없으면 포함 검사다.
  // 기본값을 키 없음으로 둔 덕에 v1.16.x 이전 규칙을 그대로 읽고 항목 크기도
  // 늘지 않는다. 세 방식 모두 대소문자를 구별하지 않는다.
  const M_INC = "inc";   // 저장하지 않는 기본값
  const M_EQ  = "eq";    // 공백을 정규화한 글자 전체가 낱말과 같음
  const M_RE  = "re";    // 정규식. 소스 문자열로 저장한다

  // 정규식 소스 길이 상한. 넘으면 규칙을 버린다. 스캔은 요소 4,000개까지 도므로
  // 되추적이 심한 패턴을 짧게 막는 것이 유일하게 값싼 방어다.
  const RE_MAX = 100;

  // 배지의 가운데 기호. 포함일 때의 문구를 건드리면 adtest E13 이 배지 문구로
  // 판정하지 못한다.
  const TEXT_OP = { [M_INC]: "⊃", [M_EQ]: "=", [M_RE]: "~" };

  // 저장된 규칙을 검사용 모양으로 고친다. scope 기본값, 낱말 트림, 일치 방식,
  // 제외 단어 정규화를 여기서 한 번만 하고 스캔 루프에서는 쓰기만 한다. not 은
  // 문자열 배열이고 v1.14.3 이전 항목에는 키 자체가 없으므로 그 경우는 빈
  // 배열이다. notRaw 는 배지에 쓸 원래 글자, not 은 대조용 소문자다. m 도
  // v1.16.x 이전 항목에는 없고, 없으면 포함 검사다.
  function textRules() {
    const out = [];
    for (const r of state.texts || []) {
      if (!r || typeof r.word !== "string") continue;
      const word = r.word.trim();
      if (!word) continue;
      const scope = (typeof r.scope === "string" && r.scope.trim())
        ? r.scope.trim() : "div";
      if (!isValid(scope)) continue;

      const mode = (r.m === M_EQ || r.m === M_RE) ? r.m : M_INC;

      // 정규식은 규칙당 한 번만 컴파일한다. 스캔 루프에서 new RegExp 를 부르면
      // 요소마다 다시 만든다. g 플래그는 쓰지 않는다. lastIndex 가 남아 같은
      // 객체로 두 번째 요소를 검사할 때 결과가 달라진다.
      let re = null;
      if (mode === M_RE) {
        if (word.length > RE_MAX) continue;
        try { re = new RegExp(word, "i"); } catch { continue; }
        // 빈 글자에도 맞는 패턴은 모든 요소를 적중시킨다. 폼과 복구가 막지만
        // 손으로 고친 저장소로도 들어올 수 있어 여기서 한 번 더 막는다.
        if (re.test("")) continue;
      }

      // 완전 일치에서 제외 단어는 아무 일도 하지 않거나 규칙 전체를 죽인다.
      // 글자 전체가 낱말과 같아야 잡히므로, 제외 단어가 낱말의 일부이면 늘
      // 막고 아니면 한 번도 막지 않는다. 폼과 복구가 그 조합을 버리지만
      // 남아 있어도 무시한다.
      const notRaw = [];
      if (mode !== M_EQ && Array.isArray(r.not)) {
        for (const s of r.not) {
          if (typeof s !== "string") continue;
          const t = s.trim();
          if (t) notRaw.push(t);
        }
      }

      out.push({
        scope, word, mode, re,
        wordLow: word.toLowerCase(),
        wordNorm: word.replace(/\s+/g, " ").trim().toLowerCase(),
        notRaw,
        not: notRaw.map((s) => s.toLowerCase())
      });
    }
    return out;
  }

  // 배지에 넣을 짧은 선택자. 기본 선택자는 길어서 그대로 쓰면 읽기 어렵다.
  function shortSel(s) {
    const t = String(s).replace(/\s+/g, " ").trim();
    return t.length > 48 ? t.slice(0, 47) + "…" : t;
  }

  // 한 규칙이 집는 후보를 문서 순서로 모은다. 표시는 하지 않는다. 표시와 판정을
  // 섞으면 조상이 먼저 칠해져 안쪽이 검사에서 빠진다.
  function textCandidates(rule, ex, prev) {
    const scope = rule.scope;
    const not = rule.not;
    const out = [];

    let nodes;
    try { nodes = document.querySelectorAll(scope); } catch { return out; }

    let checked = 0;
    for (const el of nodes) {
      if (++checked > 4000) break;              // 폭주 방지
      if (KEEP.has(el.tagName)) continue;
      if (el.id?.startsWith("__uc")) continue;
      if (el.closest("#__uc_pick")) continue;
      if (el.closest(TEXT_SKIP)) continue;      // 메뉴·푸터 안쪽 (자신 포함)
      if (ex && el.closest(ex)) continue;       // 사이트 예외 보호

      const t = el.textContent || "";
      if (t.length > TEXT_MAX) continue;
      const low = t.toLowerCase();

      // 낱말 일치 (v1.17.0). 세 방식이 여기서만 갈리고 자리는 그대로 첫 검사다.
      // 뒤로 미루면 querySelector 와 getBoundingClientRect 가 4,000개 전부에
      // 걸리고 그것이 낱말 검사보다 비싸다. 공백 정규화는 완전 일치에서만 한다.
      let hit;
      if (rule.mode === M_RE) hit = rule.re.test(t);
      else if (rule.mode === M_EQ) hit = low.replace(/\s+/g, " ").trim() === rule.wordNorm;
      else hit = low.includes(rule.wordLow);
      if (!hit) continue;

      // 제외 단어 (v1.15.0). 하나라도 들어 있으면 이 요소를 후보에서 뺀다.
      // 요소 단위 거부라 낱말을 품지 않는 맥락어도 제외 근거가 된다. 일치
      // 방식과 무관하게 언제나 포함 검사이고, 완전 일치에서는 textRules 가
      // 목록을 비워 두어 이 분기를 아예 타지 않는다.
      if (not.length) {
        let blocked = false;
        for (const n of not) { if (low.includes(n)) { blocked = true; break; } }
        if (blocked) continue;
      }

      // 메뉴·푸터를 자손으로 품은 껍데기 제외 (v1.14.2)
      if (el.querySelector(TEXT_SKIP)) continue;

      // 직전 적중은 평소 시트가 숨기고 있어 크기가 0 이다. 그 시트는 Firefox 에서 비동기로만 걷혀
      // 다시 잴 수 없으니 이미 잰 크기를 믿는다.
      // shortcut: 숨긴 동안 작아지거나 안쪽에 새 적중이 생겨도 그대로 둔다, 실제 사이트에서 문제가 보이면 다시 잰다
      if (!prev.has(el)) {
        const rect = el.getBoundingClientRect();
        if (rect.width < MIN_W || rect.height < MIN_H) continue;
      }

      out.push(el);
    }
    return out;
  }

  // 조상과 자손이 함께 걸리면 가장 안쪽만 남긴다. 목록은 문서 순서여야 한다.
  // 문서 순서에서 조상은 언제나 자손보다 앞에 오므로, 열린 조상만 쌓아 두고
  // 뒤에 자손이 나타나는 순간 그 조상을 버린다. 전수 비교(O(n²))가 필요 없다.
  function innermostOnly(list) {
    const drop = new Set();
    const stack = [];
    for (const el of list) {
      // 이미 닫힌 형제는 그대로 살린다
      while (stack.length && !stack[stack.length - 1].contains(el)) stack.pop();
      // 남은 것은 모두 el 의 조상이다
      while (stack.length && stack[stack.length - 1].contains(el)) drop.add(stack.pop());
      stack.push(el);
    }
    return list.filter((el) => !drop.has(el));
  }

  // 텍스트 적중의 클래스와 배지는 진단 모드에서만 붙인다
  function markTexts() {
    document.querySelectorAll("." + TEXTHIT).forEach((e) => {
      e.classList.remove(TEXTHIT);
      e.removeAttribute(WHY);
    });
    if (!state.diagnose) return;
    for (const [el, why] of textHits) {
      el.classList.add(TEXTHIT);
      el.setAttribute(WHY, why);
    }
  }

  // 적중은 textHits 에 담는다
  function scanTexts() {
    const prev = textHits;
    textHits = new Map();
    markTexts();

    if (!state.banner) return;
    const rules = textRules();
    if (!rules.length) return;

    const ex = exJoin();

    // 규칙마다 후보를 모아 한 자리에 합친다. 같은 요소가 여러 규칙에 걸리면
    // 먼저 선언한 규칙이 배지를 갖는다. 예전 closest 건너뛰기와 결과가 같다.
    // 배지의 가운데 기호가 일치 방식을 알리고(⊃ 포함, = 완전 일치, ~ 정규식),
    // 꼬리는 제외 단어가 있을 때만 붙는다. 포함일 때의 문구를 건드리면
    // adtest E13(규칙 둘에 걸린 요소의 배지 선점)이 문구로 판정하지 못한다.
    const why = new Map();
    for (const r of rules) {
      let badge = `텍스트 · ${shortSel(r.scope)} ${TEXT_OP[r.mode]} "${shortSel(r.word)}"`;
      if (r.notRaw.length) badge += ` − "${r.notRaw.join('", "')}"`;
      for (const el of textCandidates(r, ex, prev)) {
        if (!why.has(el)) why.set(el, badge);
      }
    }
    if (!why.size) return;

    // 규칙별 목록은 각각 문서 순서지만 합치면 어긋난다. 조상 걷어내기가
    // 문서 순서에 기대므로 여기서 다시 세운다.
    const order = [...why.keys()].sort((a, b) =>
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1);

    for (const el of innermostOnly(order)) textHits.set(el, why.get(el));
    markTexts();
  }

  /* ---------- 빈 공간 회수 ---------- */
  function hasOwnText(el) {
    for (const n of el.childNodes) {
      if (n.nodeType === 3 && n.textContent.trim()) return true;
    }
    return false;
  }

  // 접힐 대상만 골라 돌려준다. 클래스를 건드리지 않아 진단 모드에서도 쓴다.
  function collapseCandidates() {
    const out = [];
    if (!state.banner) return out;

    // 숨김 대상 전체. 접힘 판정과 형제 검사가 같은 기준을 써야 한다.
    // 예전에는 형제 검사에서 텍스트 규칙이 빠져, 진단 모드에서 접힘 예정
    // 판정이 실제 동작과 달라졌다.
    const sel = allSel();
    const ex = exJoin();
    let targets = [];
    if (sel) {
      try { targets = [...document.querySelectorAll(sel)]; } catch { return out; }
    }
    if (textHits.size) {
      targets = [...new Set([...targets, ...textHits.keys()])].sort((a, b) =>
        (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1);
    }

    const seen = new Set();
    for (const t of targets) {
      let node = t;
      for (let depth = 0; depth < 3; depth++) {
        const p = node.parentElement;
        if (!p || KEEP.has(p.tagName)) break;
        if (hasOwnText(p)) break;
        if (ex && p.closest(ex)) break;   // 예외로 보호한 영역은 접지 않는다

        const kids = Array.from(p.children);
        const empty = kids.every((c) => {
          if (c === node) return true;
          if (c.id?.startsWith("__uc")) return true;
          if (c.tagName === "STYLE" || c.tagName === "SCRIPT") return true;
          if (textHits.has(c)) return true;
          if (sel) {
            try { if (c.matches(sel)) return true; } catch { /* 무시 */ }
          }
          return getComputedStyle(c).display === "none";
        });
        if (!empty) break;

        if (!seen.has(p)) { seen.add(p); out.push(p); }
        node = p;
      }
    }
    return out;
  }

  function collapse() {
    folded = (state.banner && !state.diagnose) ? collapseCandidates() : [];
  }

  /* ---------- 규칙 출처 표시 ---------- */
  // 텍스트 규칙이 붙인 WHY 는 scanTexts 가 관리하므로 여기서 지우지 않는다.
  function clearMarks() {
    document
      .querySelectorAll(`.${SRC_BASE},.${SRC_CUSTOM},.${SRC_EX},.${WILL},.${REL}`)
      .forEach((e) => {
        e.classList.remove(SRC_BASE, SRC_CUSTOM, SRC_EX, WILL, REL);
        if (!e.classList.contains(TEXTHIT)) e.removeAttribute(WHY);
      });
  }

  // 이 요소가 어느 예외 때문에 살아남았는지 알린다. "예외 유지" 만 적어 두면
  // 예외가 여러 개일 때 어느 것을 지워야 하는지 알 수 없다.
  function exReason(el, list) {
    for (const s of list) {
      try { if (el.matches(s)) return "예외 유지 · " + shortSel(s); } catch { /* 무시 */ }
    }
    for (const s of list) {
      try { if (el.closest(s)) return "예외 유지(자손) · " + shortSel(s); } catch { /* 무시 */ }
    }
    return "예외 유지 · 기본 규칙 일치";
  }

  // 무엇이 이 요소를 숨겼는지 테두리 색과 배지로 알린다. 읽기 전용이다.
  // 한 요소에는 가장 우선하는 출처 하나만 남긴다.
  //
  // 표시 상한(MARK_MAX)을 쓰는 방식이 두 번 문제가 됐다. 칠하면서 예산을
  // 깎으면 먼저 칠하는 출처가 예산을 독차지한다. 접힘 예정부터 칠하면
  // 기본 규칙에 걸리지 않는 내 규칙이 굶고, 기본 규칙부터 칠하면 예외와
  // 접힘 예정이 굶는다. 게다가 BASE 를 하나씩 돌며 칠하면 앞쪽 선택자에
  // 수백 건이 걸릴 때 뒤쪽 선택자(ins.adsbygoogle, iframe[src*=…])에 걸린
  // 요소가 통째로 빠진다. 그래서 칠하기 전에 계획을 모으고, 예산은 순위별로
  // 나눈 뒤 남는 몫을 다시 돌린다.
  function markSources() {
    clearMarks();
    if (!state.diagnose) return;

    const COLLECT_MAX = 4000;   // 계획 수집 상한. 폭주 방지
    const plan = new Map();     // 요소 → {cls, why, rank}
    let collected = 0;

    // 텍스트 규칙은 scanTexts 가 이미 칠했다. 예산을 쓰지 않고
    // 배지 위치 기준만 붙이며, 다른 출처가 덮어쓰지 못하게 잠근다.
    const fixed = new Set(document.querySelectorAll("." + TEXTHIT));
    for (const el of fixed) {
      if (getComputedStyle(el).position === "static") el.classList.add(REL);
    }

    // why 는 문자열이거나 (el) => 문자열 이다. 기본 규칙의 배지 문구는
    // BASE 를 하나씩 대조해야 나오는데, 예산에서 잘릴 요소까지 대조하면
    // 낭비다. 살아남은 것만 나중에 계산한다.
    function want(el, cls, why) {
      if (!el || el.nodeType !== 1) return;
      if (el === document.body || el === document.documentElement) return;
      if (el.id?.startsWith("__uc")) return;
      if (el.closest("#__uc_pick")) return;
      if (fixed.has(el)) return;

      const rank = SRC_RANK[cls] || 0;
      const prev = plan.get(el);
      if (prev) {
        if (rank > prev.rank) plan.set(el, { cls, why, rank });
        return;
      }
      if (collected >= COLLECT_MAX) return;
      collected++;
      plan.set(el, { cls, why, rank });
    }

    function baseWhy(el) {
      for (const s of BASE) {
        try { if (el.matches(s)) return "기본 규칙 · " + shortSel(s); }
        catch { /* 무시 */ }
      }
      return "기본 규칙";
    }

    // 순위별 균등 배분. 흔한 출처가 드문 출처를 굶기지 않는다.
    function apply() {
      const groups = new Map();   // 순위 → 요소 배열 (수집 순서 = 문서 순서)
      for (const [el, v] of plan) {
        if (!groups.has(v.rank)) groups.set(v.rank, []);
        groups.get(v.rank).push(el);
      }

      const keys = [...groups.keys()];
      const take = new Map(keys.map((k) => [k, 0]));
      let left = MARK_MAX;
      let active = keys.filter((k) => groups.get(k).length > 0);

      while (left > 0 && active.length) {
        const quota = Math.max(1, Math.floor(left / active.length));
        for (const k of active) {
          if (left <= 0) break;
          const add = Math.min(quota, groups.get(k).length - take.get(k), left);
          take.set(k, take.get(k) + add);
          left -= add;
        }
        active = active.filter((k) => take.get(k) < groups.get(k).length);
      }

      for (const k of keys) {
        const list = groups.get(k);
        const n = take.get(k);
        for (let i = 0; i < n; i++) {
          const el = list[i];
          const v = plan.get(el);
          el.classList.add(v.cls);
          el.setAttribute(WHY, typeof v.why === "function" ? v.why(el) : v.why);
          // 배지의 위치 기준. static 인 요소에만 붙여 레이아웃 변화를 줄인다.
          if (getComputedStyle(el).position === "static") el.classList.add(REL);
        }
      }
    }

    // 배너 숨기기가 꺼진 사이트에서도 무엇이 걸리는지는 알려준다.
    // 실제로 숨는 것이 없으니 회색 하나로만 표시한다.
    if (!state.banner) {
      let nodes = [];
      try { nodes = document.querySelectorAll(BASE_SEL); } catch { /* 무시 */ }
      for (const el of nodes) want(el, WILL, "배너 숨기기 꺼짐 · 켜면 숨음");
      for (const s of customSel()) {
        let list;
        try { list = document.querySelectorAll(s); } catch { continue; }
        for (const el of list) want(el, WILL, "배너 숨기기 꺼짐 · 내 규칙");
      }
      apply();
      return;
    }

    const g = guard();

    // 내 규칙. 지울 수 있는 규칙이라 순위가 가장 높다.
    for (const s of customSel()) {
      let nodes;
      try { nodes = document.querySelectorAll(s); } catch { continue; }
      for (const el of nodes) want(el, SRC_CUSTOM, "내 규칙 · " + shortSel(s));
    }

    if (state.nb) {
      // 기본 규칙을 껐다. 켜면 숨을 요소를 알려준다.
      let nodes = [];
      try { nodes = document.querySelectorAll(BASE_SEL); } catch { /* 무시 */ }
      for (const el of nodes) want(el, SRC_EX, "기본규칙 끔 · 일치하지만 유지");
    } else {
      // 예외로 살아남은 것. 가드가 실제로 빼낸 것만 담는다. 예전에는
      // BASE_SEL 전체에 예외를 걸어 두고 기본 규칙 패스가 덮어쓰게 했는데,
      // 그러면 예외와 무관한 수백 건이 예산을 먼저 먹었다.
      if (g) {
        const list = exSel();
        const j = exJoin();
        let nodes = [];
        try { nodes = document.querySelectorAll(BASE_SEL); } catch { /* 무시 */ }
        for (const el of nodes) {
          let saved = false;
          try { saved = !!el.closest(j); } catch { /* 무시 */ }
          if (saved) want(el, SRC_EX, exReason(el, list));
        }
      }

      // 기본 규칙. 조합 선택자 하나로 문서 순서대로 훑는다. 선택자별로
      // 나눠 돌면 앞쪽 선택자가 예산을 독차지한다.
      const bs = baseSel();
      if (bs) {
        let nodes = [];
        try { nodes = document.querySelectorAll(bs); } catch { /* 무시 */ }
        for (const el of nodes) want(el, SRC_BASE, baseWhy);
      }
    }

    // 접힘 예정이 가장 약하다. 직접 걸린 규칙이 있으면 위에서 이미 담겼다.
    for (const p of collapseCandidates()) {
      want(p, WILL, "접힘 예정 · 숨긴 요소만 남음");
    }

    apply();
  }

  // 변화가 멈추고 200ms 뒤에 스캔하되, 첫 변화에서 600ms 가 지나면 계속 바뀌어도 스캔한다.
  // 끝없이 바뀌는 페이지(피드·광고 순환)에서 대기만 다시 시작돼 스캔이 영영 돌지 않았다 (ANALYSIS A1)
  const SCAN_MAX_WAIT = 600;
  let scanTimer = 0, scanSince = 0;
  function scheduleScan() {
    const now = performance.now();
    if (!scanTimer) scanSince = now;
    clearTimeout(scanTimer);
    // 순서가 중요하다. 접힘 판정은 텍스트 결과를, 출처 표시는 접힘 후보를 본다.
    scanTimer = setTimeout(() => {
      scanTimer = 0;
      scanTexts();
      collapse();
      paint();
      markSources();
    }, Math.max(0, Math.min(200, scanSince + SCAN_MAX_WAIT - now)));
  }

  // 클래스 변경은 attributes 변화라 감시 대상이 아니다. 되먹임 없음.
  // 자리 선택자는 형제가 바뀌면 다른 요소를 가리키므로 스캔을 기다리지 않고 바로 다시 칠한다
  const observer = new MutationObserver(() => { paint(); scheduleScan(); });
  function startObserver() {
    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
      scheduleScan();
    } else {
      document.addEventListener("DOMContentLoaded", startObserver, { once: true });
    }
  }
  startObserver();

  /* ---------- 입력 요소 판별 ---------- */
  const SAFE_INPUT_TYPES = new Set([
    "checkbox", "radio", "button", "submit", "reset",
    "file", "image", "color", "range"
  ]);

  function isEditable(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    if (tag === "TEXTAREA" || tag === "SELECT") return true;
    if (tag === "INPUT") return !SAFE_INPUT_TYPES.has((el.type || "text").toLowerCase());
    return false;
  }

  function deepActive() {
    let el = document.activeElement;
    while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
    return el;
  }

  function inEditableContext(e) {
    const path = typeof e.composedPath === "function" ? e.composedPath() : [];
    if (isEditable(path[0] || e.target)) return true;
    if (isEditable(deepActive())) return true;
    if (document.designMode === "on") return true;
    return false;
  }

  /* ---------- 이벤트 차단 ---------- */
  let picking = false;

  const GUARDS = {
    contextmenu: () => state.rightclick,
    selectstart: () => state.copy,
    dragstart:   () => state.copy,
    copy:        () => state.copy,
    cut:         () => state.copy
  };

  for (const [type, active] of Object.entries(GUARDS)) {
    window.addEventListener(type, (e) => {
      if (picking) return;
      if (active()) e.stopImmediatePropagation();
    }, true);
  }

  // 배경의 tabs.goBack 으로 움직이고, 배경에 닿지 못했거나 실패했다고 답할 때만 history 로 대신한다
  function navigate(type) {
    const fallback = () => { type === "GO_BACK" ? history.back() : history.forward(); };
    try {
      chrome.runtime.sendMessage({ type }).then((res) => { if (!res?.ok) fallback(); }, fallback);
    } catch {
      fallback();
    }
  }

  window.addEventListener("keydown", (e) => {
    if (picking) return;

    if (state.copy && (e.ctrlKey || e.metaKey) &&
        ["c", "x", "a"].includes(e.key.toLowerCase())) {
      e.stopImmediatePropagation();
      return;
    }

    if (!state.back) return;
    if (e.key !== "Backspace") return;
    if (e.repeat) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (inEditableContext(e)) return;

    e.preventDefault();
    e.stopImmediatePropagation();
    navigate(e.shiftKey ? "GO_FORWARD" : "GO_BACK");
  }, true);

  /* ---------- 요소 선택기 ---------- */
  let pickUI = null;
  let pickTarget = null;      // 지금 조준한 요소
  let pickEff = null;         // 실제로 테두리를 그리는 요소. 예외 모드에서는 조상
  let pickDeep = null;        // 마지막 mousemove 가 집은 최하위 요소
  let pickPos = { x: 0, y: 0 };
  let pickStack = [];         // 같은 좌표에 겹친 요소들 (Tab 순환용)
  let pickStackIdx = 0;
  let pickRaf = 0;            // 스크롤·리사이즈 때 위치 갱신 예약
  let pickLock = null;        // 키보드로 고른 조준 고정. { x, y, veiled: [[el, 원래 인라인 값]] } (D016)
  let pickShields = new Map(); // iframe → 가림막 (D031)
  let pickObs = null;         // 새 iframe 을 보고 가림막을 다시 놓는다
  let pickCount = 0;
  let exCount = 0;            // 이번 세션에서 추가한 예외 건수
  let pickMode = "sel";       // "sel" = 숨김 등록, "ex" = 기본 규칙 예외
  let recentPicks = [];       // 이번 선택 세션에서 추가한 항목만 되돌린다

  // 예외 선택자의 합격선. 정밀도는 그 선택자가 덮는 요소 가운데 기본 규칙에
  // 걸린 것의 비율이다. 예전에는 25% 까지 허용해, 페이지 전체에 쓰인
  // 레이아웃 클래스가 뽑혀 본문까지 기본 규칙에서 빠져나갔다.
  const EX_MIN_PRECISION = 0.8;
  const EX_MAX_HITS = 12;     // 예외 하나가 한꺼번에 살릴 수 있는 상한

  // 화면 아래 줄은 둘이다. 안내줄은 조작키만 담고 모드가 바뀔 때만 고친다.
  // 상태줄은 지금 모드와 방금 한 일을 담는다. 예전에는 한 줄이 둘을 겸해,
  // 예외를 추가하고 나면 문구가 길어져 조작키가 화면 밖으로 밀려났다.
  function showGuide(text) {
    const el = pickUI?.querySelector("#__uc_guide");
    if (el) el.textContent = text;
  }

  function showStatus(text) {
    const el = pickUI?.querySelector("#__uc_status");
    if (!el) return;
    el.dataset.mode = pickMode;   // 색은 CSS 가 고른다
    el.textContent = text;
  }

  function modeLabel() {
    return pickMode === "ex" ? "예외 모드" : "숨김 모드";
  }

  // 안내줄 문구. 조작키만 적는다.
  function modeHint() {
    return pickMode === "ex"
      ? "클릭·Enter 예외 추가 · e 숨김 모드 · ↑↓ 부모·자식 · Tab 겹친 요소 · " +
        "Ctrl+Z 되돌리기 · ESC 종료"
      : "클릭·Enter 등록 · e 예외 모드 · ↑↓ 부모·자식 · Tab 겹친 요소 · " +
        "Ctrl+Z 되돌리기 · ESC 종료";
  }

  // 상태줄의 기본 문구. 아직 아무것도 하지 않았거나 모드를 바꿨을 때 쓴다.
  function statusIdle() {
    return pickMode === "ex"
      ? `${modeLabel()} · 예외 ${exCount}건 추가`
      : `${modeLabel()} · 선택자 ${pickCount}건 추가`;
  }

  // 자동 생성 클래스는 아예 쓰지 않는다
  const BAD_CLASS =
    /(?:^|[-_])(?:\d{3,})(?:$|[-_])|^[a-z0-9]{12,}$|^css-[a-z0-9]+$|^sc-[a-zA-Z0-9]+$|^jsx-\d+$/;

  // 동작·상태 클래스는 다른 요소에도 널리 붙고 상태에 따라 사라진다.
  // 지우지는 않되 순위를 뒤로 밀어 구조를 나타내는 이름을 먼저 쓴다.
  // 예: _need_nclick, type_animation, _nlog_impression, is-active
  const STATE_CLASS =
    /^(?:_|js[-_]|is[-_]|has[-_]|ui[-_]|type[-_])|(?:^|[-_])(?:active|selected|current|open|opened|close|closed|show|shown|hide|hidden|on|off|hover|focus|disabled|animation|animated|impression|nclick|need|link|item)(?:$|[-_])/i;

  function classScore(c) {
    let s = 0;
    if (STATE_CLASS.test(c)) s += 10;
    if (c.startsWith("_")) s += 5;
    if (c.length < 5) s += 2;      // 너무 짧은 이름은 겹치기 쉽다
    if (c.length > 24) s += 1;
    return s;
  }

  function goodClasses(el) {
    return Array.from(el.classList)
      .filter((c) => c.length > 2 && c.length < 32 && !BAD_CLASS.test(c) &&
                     !c.startsWith("__uc"))
      .map((c, i) => ({ c, i, s: classScore(c) }))
      .sort((a, b) => (a.s - b.s) || (a.i - b.i))
      .map((o) => o.c);
  }

  function matchCount(sel) {
    try { return document.querySelectorAll(sel).length; } catch { return -1; }
  }

  // 이 요소가 내장 기본 선택자에 걸리는지. 예외는 기본 규칙에만 쓸모가 있다.
  function matchesBase(el) {
    if (!el || el.nodeType !== 1) return false;
    try { return el.matches(BASE_SEL); } catch { return false; }
  }

  // 예외로 뺄 실제 대상을 찾는다. 겨냥한 요소가 기본 규칙에 직접 걸리지
  // 않으면 걸리는 가장 가까운 조상을 쓴다. 화면에서 눈에 보이고 마우스가
  // 집는 것은 배너 안쪽의 a 나 img 인데, 기본 규칙에 걸리는 것은 그것을
  // 감싼 div 다. 예전에는 겨냥한 요소만 검사해 클릭이 거의 모두 거절됐다.
  function baseTargetFor(el) {
    if (!el || el.nodeType !== 1) return null;
    if (matchesBase(el)) return el;
    let up;
    try { up = el.closest(BASE_SEL); } catch { return null; }
    if (!up || up === document.body || up === document.documentElement) return null;
    return up;
  }

  // 이 선택자가 덮는 요소 중 기본 규칙에 걸리는 것의 수
  function baseHits(sel) {
    let nodes;
    try { nodes = document.querySelectorAll(sel); } catch { return 0; }
    let n = 0;
    for (const el of nodes) {
      try { if (el.matches(BASE_SEL)) n++; } catch { /* 무시 */ }
    }
    return n;
  }

  // 한 요소를 나타내는 부분 선택자. 클래스가 쓸 만하면 쓰고,
  // 아니면 형제 순서로 구분한다.
  function partFor(node) {
    const tag = node.tagName.toLowerCase();
    const cls = goodClasses(node);
    if (cls.length) {
      return tag + "." + cls.slice(0, 2).map((c) => CSS.escape(c)).join(".");
    }
    const p = node.parentElement;
    if (p) {
      const sibs = Array.from(p.children).filter((c) => c.tagName === node.tagName);
      if (sibs.length > 1) return `${tag}:nth-of-type(${sibs.indexOf(node) + 1})`;
    }
    return tag;
  }

  // 1건에 정확히 맞는 선택자를 우선한다. 못 찾으면 가장 적게 맞는 후보를 쓴다.
  // 예전에는 2건까지 허용해 의도하지 않은 요소가 같이 숨었다.
  function selectorFor(el) {
    if (el.id && !/\d{4,}/.test(el.id)) {
      const s = `#${CSS.escape(el.id)}`;
      if (matchCount(s) === 1) return s;
    }

    const parts = [];
    let best = null, bestN = Infinity;
    let node = el;

    for (let i = 0; i < 6 && node && node !== document.body; i++) {
      parts.unshift(partFor(node));
      const candidate = parts.join(" > ");
      const n = matchCount(candidate);

      if (n === 1) {
        try { if (document.querySelector(candidate) === el) return candidate; } catch { /* 무시 */ }
      }
      if (n > 0 && n < bestN) {
        try {
          if ([...document.querySelectorAll(candidate)].includes(el)) {
            best = candidate; bestN = n;
          }
        } catch { /* 무시 */ }
      }
      node = node.parentElement;
    }

    // 여러 건에 맞는다면 형제 순서를 붙여 한 건으로 좁혀 본다
    if (best && bestN > 1) {
      const p = el.parentElement;
      if (p) {
        const sibs = Array.from(p.children).filter((c) => c.tagName === el.tagName);
        if (sibs.length > 1) {
          const tight = `${best}:nth-of-type(${sibs.indexOf(el) + 1})`;
          if (matchCount(tight) === 1) return tight;
        }
      }
    }
    return best || parts.join(" > ");
  }

  // 예외용 선택자는 숨김용과 목표가 반대다. 숨김은 한 요소만 정확히 집어야
  // 하지만, 예외는 같은 종류를 한꺼번에 빼는 편이 낫다. news.naver.com 의
  // 정정보도 배너처럼 같은 클래스가 여섯 개 걸리면 여섯 번 지정할 이유가 없다.
  //
  // 다만 "많이 걸리는 클래스" 를 고르면 안 된다. 예전 판은 그렇게 해서
  // 페이지 절반에 쓰인 레이아웃 클래스(.frame 따위) 를 뽑았고, 예외 하나가
  // 본문까지 기본 규칙에서 빼냈다. 예외는 숨김을 취소하는 동작이라 과잉
  // 일치의 대가가 숨김 규칙보다 크다. 그래서 정밀도를 먼저 걸러 내고,
  // 통과한 후보 중에서는 가장 좁은 것을 쓴다.
  // 돌려주는 값: { sel, hits, nodes, kind }
  function exCandidate(el) {
    if (el.id && !/\d{4,}/.test(el.id)) {
      const s = `#${CSS.escape(el.id)}`;
      try {
        if (document.querySelector(s) === el) {
          return { sel: s, hits: 1, nodes: 1, kind: "id" };
        }
      } catch { /* 무시 */ }
    }

    let best = null;
    for (const c of goodClasses(el)) {
      const s = `.${CSS.escape(c)}`;
      const total = matchCount(s);
      if (total <= 0) continue;
      const hits = baseHits(s);
      if (!hits) continue;                            // 기본 규칙과 무관하다
      if (hits / total < EX_MIN_PRECISION) continue;  // 관계없는 요소를 끌고 온다
      if (hits > EX_MAX_HITS) continue;               // 한 번에 너무 많이 살린다
      if (!best || total < best.nodes) {
        best = { sel: s, hits, nodes: total, kind: "class" };
      }
    }
    if (best) return best;

    // 쓸 만한 클래스가 없으면 이 요소 하나만 예외로 한다
    const s = selectorFor(el);
    return { sel: s, hits: baseHits(s), nodes: Math.max(0, matchCount(s)), kind: "single" };
  }

  function stopPicker() {
    if (!picking) return;
    picking = false;
    pickCount = 0;
    exCount = 0;
    pickMode = "sel";
    recentPicks = [];
    pickTarget = null;
    pickEff = null;
    pickDeep = null;
    pickStack = [];
    pickStackIdx = 0;
    unlockPick();
    if (pickRaf) { cancelAnimationFrame(pickRaf); pickRaf = 0; }
    pickObs?.disconnect();
    pickObs = null;
    pickShields.clear();
    pickUI?.remove();
    pickUI = null;
    window.removeEventListener("mousemove", onPickMove, true);
    window.removeEventListener("click", onPickClick, true);
    for (const t of PRESS) window.removeEventListener(t, onPickPress, true);
    window.removeEventListener("keydown", onPickKey, true);
    window.removeEventListener("scroll", onPickScroll, true);
    window.removeEventListener("resize", onPickScroll, true);
  }

  // 테두리와 라벨의 위치만 다시 잡는다. 선택자와 일치 건수를 다시 세지
  // 않으므로 스크롤 중에 불러도 싸다. highlight 가 색과 문구를 정한 뒤
  // 마지막에 이것을 부르고, 스크롤·리사이즈는 이것만 부른다.
  function placePick() {
    if (!pickUI || !pickEff) return;
    const r = pickEff.getBoundingClientRect();

    const box = pickUI.querySelector("#__uc_box");
    Object.assign(box.style, {
      left: `${r.left}px`, top: `${r.top}px`,
      width: `${r.width}px`, height: `${r.height}px`
    });

    const label = pickUI.querySelector("#__uc_label");
    const below = r.bottom + 26 < window.innerHeight;
    Object.assign(label.style, {
      left: `${Math.max(4, r.left)}px`,
      top: below ? `${r.bottom + 4}px` : `${Math.max(4, r.top - 26)}px`
    });
  }

  // 스크롤과 리사이즈에서는 조준을 바꾸지 않고 위치만 따라가게 한다.
  // 순서가 있다. 먼저 겹친 요소 목록을 버린다. 좌표가 가리키는 요소가
  // 달라졌으므로 그대로 두면 Tab 이 화면에 없는 요소를 돌린다. 위치 계산은
  // 다음 프레임으로 미뤄 연속 스크롤에서 한 프레임에 한 번만 돌게 한다.
  // 예전에는 두 이벤트를 아예 듣지 않아, 스크롤하면 테두리가 제자리에 남아
  // 엉뚱한 요소를 가리켰다.
  function onPickScroll() {
    if (!picking) return;
    pickStack = [];
    pickStackIdx = 0;
    schedulePlace();
  }
  function schedulePlace() {
    if (pickRaf) return;
    pickRaf = requestAnimationFrame(() => {
      pickRaf = 0;
      placePick();
      placeShields();
    });
  }

  // 보이는 iframe 마다 같은 자리에 가림막을 둔다. 가림막이 마우스를 받아 iframe 안으로
  // 이벤트가 가지 않고, onPickMove 가 그 자리의 실제 요소(iframe 이나 그 위 덮개)를 조준한다 (D031).
  // 가림막은 #__uc_pick 안에 있어 페이지 요소를 고르는 곳들의 제외 규칙을 그대로 탄다.
  function placeShields() {
    if (!pickUI) return;
    const live = new Set();
    for (const f of document.querySelectorAll("iframe")) {
      const r = f.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      live.add(f);
      let s = pickShields.get(f);
      if (!s) {
        s = document.createElement("div");
        s.className = "__uc_shield";
        pickUI.appendChild(s);
        pickShields.set(f, s);
      }
      Object.assign(s.style, {
        left: `${r.left}px`, top: `${r.top}px`,
        width: `${r.width}px`, height: `${r.height}px`
      });
    }
    for (const [f, s] of pickShields) {
      if (!live.has(f)) { s.remove(); pickShields.delete(f); }
    }
  }

  // 조준한 요소를 테두리와 라벨로 표시한다. 라벨에 일치 건수를 함께 보여
  // 클릭 전에 과·소 매칭을 알 수 있게 한다.
  // 예외 모드에서는 실제로 예외가 될 요소(기본 규칙에 걸린 조상)에 테두리를
  // 그리고, 정밀도를 "걸린 수/덮는 수" 로 적는다. 6/6 이면 그 묶음만 살리고
  // 23/46 이면 페이지 절반을 건드린다는 뜻이다.
  function highlight(el) {
    if (!pickUI || !el) return;
    pickTarget = el;

    const ex = pickMode === "ex";
    const eff = ex ? (baseTargetFor(el) || el) : el;
    const ok = !ex || matchesBase(eff);
    pickEff = eff;

    const box = pickUI.querySelector("#__uc_box");
    const tint = ex ? (ok ? "#27ae60" : "#e67e22") : "#2d7ff9";
    Object.assign(box.style, {
      borderColor: tint,
      background: ex
        ? (ok ? "rgba(39,174,96,.18)" : "rgba(230,126,34,.18)")
        : "rgba(45,127,249,.18)"
    });

    const label = pickUI.querySelector("#__uc_label");

    if (ex) {
      if (ok) {
        const cand = exCandidate(eff);
        const up = eff !== el ? ", 부모로 올림" : "";
        const one = cand.kind === "single" ? ", 이 요소만" : "";
        label.textContent =
          `예외 · ${cand.sel}  (기본 규칙 ${cand.hits}/${cand.nodes}${one}${up})`;
      } else {
        label.textContent = "예외 · 기본 규칙에 걸린 조상이 없습니다";
      }
      label.style.background = tint;
    } else {
      const sel = selectorFor(el);
      const n = matchCount(sel);
      label.textContent = n === 1 ? sel : `${sel}  (${n < 0 ? "오류" : n + "건"})`;
      label.style.background = n === 1 ? "#2d7ff9" : "#e67e22";
    }

    placePick();
  }

  // 키보드로 고른 요소를 클릭할 수 있게 조준을 고정하고, 그 좌표에서 고른 요소보다 위에 겹친
  // 덮개를 흐리게·클릭 통과로 만든다 (D016). 덮개를 치우지 않으면 클릭 직전의 마우스 이동이
  // 조준을 덮개로 되돌린다. 원래 인라인 값을 적어 두었다가 풀 때 그대로 돌린다.
  const VEIL = { opacity: "0.15", "pointer-events": "none" };
  function lockPick(el) {
    unlockPick();
    const stack = document.elementsFromPoint(pickPos.x, pickPos.y);
    const i = stack.indexOf(el);
    const veiled = [];
    for (const c of i > 0 ? stack.slice(0, i) : []) {
      if (c.id?.startsWith("__uc") || pickUI?.contains(c) ||
          c === document.body || c === document.documentElement) continue;
      const saved = {};
      for (const p in VEIL) {
        saved[p] = [c.style.getPropertyValue(p), c.style.getPropertyPriority(p)];
        c.style.setProperty(p, VEIL[p], "important");
      }
      veiled.push([c, saved]);
    }
    pickLock = { x: pickPos.x, y: pickPos.y, veiled };
  }
  function unlockPick() {
    for (const [c, saved] of pickLock?.veiled || []) {
      for (const p in saved) {
        const [v, prio] = saved[p];
        if (v) c.style.setProperty(p, v, prio); else c.style.removeProperty(p);
      }
    }
    pickLock = null;
  }

  function onPickMove(e) {
    let el = e.target;
    if (el?.classList?.contains("__uc_shield")) {
      el = document.elementsFromPoint(e.clientX, e.clientY).find((c) => !pickUI.contains(c));
    }
    if (!el || el.nodeType !== 1 || el.id?.startsWith("__uc")) return;
    // 고정 중에는 24px 넘게 움직여야 마우스 조준으로 돌아간다
    if (pickLock) {
      if (Math.hypot(e.clientX - pickLock.x, e.clientY - pickLock.y) < 24) return;
      unlockPick();
    }
    pickPos = { x: e.clientX, y: e.clientY };
    pickDeep = el;
    pickStack = [];
    pickStackIdx = 0;
    highlight(el);
  }

  // 부모로 올라간다. 감싸는 컨테이너를 고를 때 여백 픽셀을 찾을 필요가 없다.
  function pickUp() {
    const p = pickTarget?.parentElement;
    if (!p || p === document.body || p === document.documentElement) {
      showStatus("더 위로 갈 수 없습니다");
      return;
    }
    highlight(p);
    lockPick(p);
  }

  // 자식으로 내려간다. 마우스가 집었던 최하위 요소 방향을 우선한다.
  function pickDown() {
    if (!pickTarget) return;
    let next = null;
    if (pickDeep && pickDeep !== pickTarget && pickTarget.contains(pickDeep)) {
      let n = pickDeep;
      while (n && n.parentElement !== pickTarget) n = n.parentElement;
      next = n;
    }
    if (!next) {
      next = Array.from(pickTarget.children).find((c) => {
        if (c.id?.startsWith("__uc")) return false;
        const r = c.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
    }
    if (!next) {
      showStatus("더 아래로 갈 수 없습니다");
      return;
    }
    highlight(next);
    lockPick(next);
  }

  // 같은 좌표에 겹친 요소를 순환한다. fixed 오버레이에 가린 요소를 집을 때 쓴다.
  function pickCycle() {
    if (!pickStack.length) {
      pickStack = document.elementsFromPoint(pickPos.x, pickPos.y)
        .filter((el) => el.nodeType === 1 && !el.id?.startsWith("__uc") && !pickUI.contains(el) &&
                        el !== document.body && el !== document.documentElement);
      pickStackIdx = Math.max(0, pickStack.indexOf(pickTarget));
    }
    if (pickStack.length < 2) {
      showStatus("이 자리에 겹친 요소가 없습니다");
      return;
    }
    pickStackIdx = (pickStackIdx + 1) % pickStack.length;
    const el = pickStack[pickStackIdx];
    pickDeep = el;
    highlight(el);
    lockPick(el);
    showStatus(`${modeLabel()} · 겹친 요소 ${pickStackIdx + 1}/${pickStack.length}`);
  }

  function toggleMode() {
    pickMode = pickMode === "ex" ? "sel" : "ex";
    if (pickTarget) highlight(pickTarget);
    showGuide(modeHint());
    showStatus(statusIdle());
  }

  // 조준한 요소를 등록한다. 클릭과 Enter 가 같은 경로를 쓴다.
  function commitPick() {
    if (!pickTarget) return;
    if (pickMode === "ex") { commitEx(); return; }

    const sel = selectorFor(pickTarget);
    const el = pickTarget;
    const entry = { sel, el, mode: "sel", added: false };
    recentPicks.push(entry);

    // 숨기지 않는다. 진단 모드의 파란 테두리가 등록을 알려준다.
    function rollback(reason) {
      const i = recentPicks.indexOf(entry);
      if (i >= 0) recentPicks.splice(i, 1);
      showStatus(reason);
    }

    updateSite((site) => {
      const list = Array.isArray(site.selectors) ? site.selectors.slice() : [];
      const dup = list.includes(sel);
      if (!dup) list.push(sel);
      site.selectors = list;
      return { dup };
    }, (res) => {
      if (!res.ok) {
        rollback(res.err ? "저장 실패: " + res.err : "설정을 읽지 못했습니다");
        return;
      }
      if (!picking) return;
      const dup = res.info.dup;
      entry.added = !dup;
      if (!dup) pickCount++;
      const n = matchCount(sel);
      showStatus(dup
        ? `이미 등록된 선택자입니다 · 선택자 ${pickCount}건 추가`
        : `선택자 ${pickCount}건 추가 · 이 규칙은 ${n}개에 적용됩니다`);
    });
  }

  // 기본 규칙에 걸린 요소를 그 자리에서 예외로 뺀다.
  // 저장이 끝나면 storage.onChanged → sync → render → markSources 경로로
  // 초록 실선으로 바뀐다. 여기서 색을 직접 칠하지 않는다.
  function commitEx() {
    const aim = pickTarget;
    if (!aim) return;

    const el = baseTargetFor(aim);
    if (!el) {
      showStatus("기본 규칙에 걸린 조상이 없습니다. 빨간 테두리가 보이는 곳을 " +
                 "클릭하거나 ↑ 로 부모를 살펴보십시오");
      return;
    }

    const cur = exJoin();
    if (cur) {
      try {
        if (el.closest(cur)) {
          showStatus("이미 예외로 유지되는 요소입니다");
          return;
        }
      } catch { /* 무시 */ }
    }

    const cand = exCandidate(el);
    const sel = cand.sel;
    const up = el !== aim;
    const entry = { sel, el, mode: "ex", added: false };
    recentPicks.push(entry);

    function rollback(reason) {
      const i = recentPicks.indexOf(entry);
      if (i >= 0) recentPicks.splice(i, 1);
      showStatus(reason);
    }

    updateSite((site) => {
      const list = Array.isArray(site.ex) ? site.ex.slice() : [];
      const dup = list.includes(sel);
      if (!dup) list.push(sel);
      site.ex = list;
      return { dup, total: list.length };
    }, (res) => {
      if (!res.ok) {
        rollback(res.err ? "저장 실패: " + res.err : "설정을 읽지 못했습니다");
        return;
      }
      if (!picking) return;
      const { dup, total } = res.info;
      entry.added = !dup;
      if (!dup) exCount++;

      if (dup) {
        showStatus(`이미 등록된 예외입니다 · 예외 ${total}개`);
        return;
      }
      // 예외가 늘어나면 기본 규칙을 끄는 편이 간단하다. 원칙과 맞물린다.
      const advise = total > 3
        ? ` · 예외가 ${total}개입니다. 옵션에서 이 사이트의 기본규칙을 끄는 편이 낫습니다`
        : "";
      showStatus(`예외 추가${up ? "(부모로 올림)" : ""} ${sel} · 기본 규칙 ` +
                 `${cand.hits}/${cand.nodes}건이 유지됩니다 · 예외 ${total}개${advise}`);
    });
  }

  // 누르기는 페이지로 보내지 않는다. 광고 링크는 click 전에 mousedown 등에서 이동하는 일이 많다 (D030)
  const PRESS = ["pointerdown", "mousedown", "mouseup"];
  function onPickPress(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  function onPickClick(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
    commitPick();
  }

  function undoPick() {
    const entry = recentPicks.pop();
    if (!entry) { showStatus("되돌릴 항목이 없습니다"); return; }

    const isEx = entry.mode === "ex";
    const field = isEx ? "ex" : "selectors";
    const name = isEx ? "예외" : "선택자";

    // 이미 저장돼 있던 항목을 다시 클릭한 경우: 규칙은 그대로 둔다
    if (!entry.added) {
      showStatus(`되돌렸습니다 · ${name} ${isEx ? exCount : pickCount}건`);
      return;
    }

    updateSite((site) => {
      const list = Array.isArray(site[field]) ? site[field].slice() : [];
      const i = list.lastIndexOf(entry.sel);
      if (i >= 0) list.splice(i, 1);

      if (list.length) site[field] = list;
      else delete site[field];
      return {};
    }, (res) => {
      if (!res.ok) {
        showStatus(res.err ? "되돌리기 저장 실패: " + res.err
                           : "설정을 읽지 못했습니다");
        return;
      }
      if (isEx) { if (exCount > 0) exCount--; }
      else { if (pickCount > 0) pickCount--; }
      showStatus(`되돌렸습니다 · ${name} ${isEx ? exCount : pickCount}건`);
    });
  }

  function onPickKey(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopImmediatePropagation();
      stopPicker();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey &&
        e.key.toLowerCase() === "z") {
      e.preventDefault();
      e.stopImmediatePropagation();
      undoPick();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    // 숨김 등록과 예외 추가를 전환한다
    if (e.key === "e" || e.key === "E") {
      e.preventDefault(); e.stopImmediatePropagation(); toggleMode(); return;
    }

    // 마우스를 움직이지 않고 조준을 바꾼다
    if (e.key === "ArrowUp" || e.key === "w" || e.key === "W") {
      e.preventDefault(); e.stopImmediatePropagation(); pickUp(); return;
    }
    if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") {
      e.preventDefault(); e.stopImmediatePropagation(); pickDown(); return;
    }
    if (e.key === "Tab") {
      e.preventDefault(); e.stopImmediatePropagation(); pickCycle(); return;
    }
    if (e.key === "Enter") {
      e.preventDefault(); e.stopImmediatePropagation(); commitPick();
    }
  }

  function startPicker() {
    if (window.top !== window) return false;   // 최상위 프레임에서만
    if (picking) return true;
    picking = true;
    pickCount = 0;
    exCount = 0;
    pickMode = "sel";
    recentPicks = [];
    pickStack = [];
    pickStackIdx = 0;
    pickEff = null;

    pickUI = document.createElement("div");
    pickUI.id = "__uc_pick";
    pickUI.innerHTML = `
      <style>
        #__uc_box{position:fixed;z-index:2147483646;pointer-events:none;
          border:2px solid #2d7ff9;background:rgba(45,127,249,.18);}
        #__uc_label{position:fixed;z-index:2147483647;pointer-events:none;
          background:#2d7ff9;color:#fff;font:12px/1.5 ui-monospace,Consolas,monospace;
          padding:2px 6px;border-radius:3px;max-width:70vw;word-break:break-all;}
        #__uc_bar{position:fixed;z-index:2147483647;pointer-events:none;
          left:50%;transform:translateX(-50%);bottom:16px;width:max-content;max-width:min(720px,92vw);
          box-sizing:border-box;display:flex;flex-direction:column;gap:2px;padding:8px 14px;
          background:rgba(29,33,38,.96);border-left:4px solid #2d7ff9;border-radius:10px;
          box-shadow:0 6px 24px rgba(0,0,0,.25);text-align:left;}
        #__uc_bar:has(#__uc_status[data-mode="ex"]){border-left-color:#27ae60;}
        #__uc_status{font:600 13px/1.5 system-ui,sans-serif;color:#fff;}
        #__uc_guide{font:12px/1.5 system-ui,sans-serif;color:#c4c9d0;}
        .__uc_shield{position:fixed;z-index:2147483645;pointer-events:auto;}
      </style>
      <div id="__uc_box"></div>
      <div id="__uc_label"></div>
      <div id="__uc_bar">
        <div id="__uc_status"></div>
        <div id="__uc_guide"></div>
      </div>`;
    document.documentElement.appendChild(pickUI);
    showGuide(modeHint());
    showStatus(statusIdle());
    placeShields();
    // 가림막을 놓는 변경은 #__uc_pick 안이라 무시해 되먹임을 막는다
    pickObs = new MutationObserver((recs) => {
      if (recs.some((r) => !pickUI?.contains(r.target))) schedulePlace();
    });
    pickObs.observe(document.documentElement, { childList: true, subtree: true });

    window.addEventListener("mousemove", onPickMove, true);
    window.addEventListener("click", onPickClick, true);
    for (const t of PRESS) window.addEventListener(t, onPickPress, true);
    window.addEventListener("keydown", onPickKey, true);
    // 스크롤은 안쪽 컨테이너에서도 일어나므로 캡처 단계에서 듣는다.
    window.addEventListener("scroll", onPickScroll, true);
    window.addEventListener("resize", onPickScroll, true);
    return true;
  }

  /* ---------- 설정 ---------- */
  // resolve() 와 맞물리도록 conf 모양으로 돌려주지만 sites 에는 내 호스트만 담긴다.
  // 읽지 못하면 null 이다.
  async function readConf() {
    let o;
    try { o = await chrome.storage.local.get(["global", SITE_KEY]); } catch { return null; }
    const fresh = o?.[SITE_KEY];
    const site = (fresh && typeof fresh === "object") ? fresh : {};
    return {
      global: { ...DEFAULT_GLOBAL, ...(o?.global || {}) },
      sites: { [HOST]: site }
    };
  }

  // 이 사이트 항목만 쓴다. 내용이 비면 항목을 지운다.
  function writeSite(site) {
    return hasContent(site) ? chrome.storage.local.set({ [SITE_KEY]: site })
                            : chrome.storage.local.remove(SITE_KEY);
  }

  // 읽고 고치고 쓰는 과정을 한 줄로 세운다. 예전에는 readConf 콜백 안에서
  // writeSite 를 불러, 빠르게 두 번 등록하면 뒤쪽이 앞쪽 변경을 덮었다.
  // 탭 사이의 경합은 이것으로 막히지 않는다. 호스트별 키를 통째로 쓰는
  // 구조라서, 다른 탭이 같은 호스트를 고치면 나중에 쓴 쪽이 남는다.
  let writeChain = Promise.resolve();
  function updateSite(mutate, cb) {
    writeChain = writeChain.then(async () => {
      const conf = await readConf();
      if (!conf) { cb({ ok: false, err: null }); return; }

      const site = { ...(conf.sites[HOST] || {}) };
      let info;
      try { info = mutate(site); }
      catch (e) { cb({ ok: false, err: e.message }); return; }

      let err = null;
      try { await writeSite(site); } catch (e) { err = e.message; }
      cb({ ok: !err, err, info });
    }).catch(() => {});
    return writeChain;
  }

  function resolve(conf) {
    const g = { ...DEFAULT_GLOBAL, ...(conf.global || {}) };
    const o = (conf.sites || {})[HOST] || {};
    return {
      banner:     o.banner     ?? g.banner,
      rightclick: o.rightclick ?? g.rightclick,
      copy:       o.copy       ?? g.copy,
      back:       o.back       ?? g.back,
      selectors:  Array.isArray(o.selectors) ? o.selectors : [],
      texts:      Array.isArray(o.texts) ? o.texts : [],
      ex:         Array.isArray(o.ex) ? o.ex : [],   // 기본 규칙 예외
      nb:         o.nb === true                      // 기본 규칙 끄기
    };
  }

  function sync() {
    readConf().then((conf) => {
      if (!conf) return;
      const next = resolve(conf);
      next.diagnose = state.diagnose;   // 진단은 세션 상태를 유지
      state = next;
      render();
    });
  }

  render();
  sync();
  // 새 문서가 떴음을 배경에 알린다. 배경이 이 탭의 진단을 끈다
  if (window.top === window) chrome.runtime.sendMessage({ type: "DOC_START" }).catch(() => {});

  chrome.storage.onChanged.addListener((changes, area) => {
    // 전역값이나 내 사이트가 바뀔 때만 다시 읽는다
    if (area === "local" && (Object.hasOwn(changes, "global") ||
                             Object.hasOwn(changes, SITE_KEY))) sync();
  });

  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    // 배경이 최상위 프레임에만 보낸다. 하위 프레임은 지금처럼 진단하지 않는다
    if (msg?.type === "DIAG") {
      state.diagnose = !!msg.on;
      if (!state.diagnose) stopPicker();
      render();
      return;
    }
    if (msg?.type === "COUNT") {
      // 예외와 nb 를 반영한 실제 적용 기준으로 센다
      let base = 0;
      const bs = baseSel();
      if (bs) {
        try { base = document.querySelectorAll(bs).length; } catch { /* 무시 */ }
      }

      // 기본 규칙에 닿았지만 예외나 nb 로 살아남은 건수
      let exHits = 0;
      try {
        const raw = document.querySelectorAll(BASE_SEL).length;
        exHits = state.nb ? raw : Math.max(0, raw - base);
      } catch { /* 무시 */ }

      let willCollapse = 0;
      try { willCollapse = collapseCandidates().length; } catch { /* 무시 */ }

      // state 대신 저장소를 직접 읽는다. 방금 저장된 변경이 즉시 반영되도록.
      readConf().then((conf) => {
        const o = conf ? (conf.sites[HOST] || {}) : {};
        const list = Array.isArray(o.selectors) ? o.selectors : [];

        const detail = list.map((sel) => {
          let n = 0, bad = false;
          try { n = document.querySelectorAll(sel).length; } catch { bad = true; }
          return { sel, n, bad };
        });

        const valid = detail.filter((d) => !d.bad).map((d) => d.sel);
        let custom = 0;
        if (valid.length) {
          try { custom = document.querySelectorAll(valid.join(",")).length; } catch { /* 무시 */ }
        }

        sendResponse({
          base, custom, rules: list.length,
          textRules: Array.isArray(o.texts) ? o.texts.length : 0,
          textHits: textHits.size,
          diagnose: state.diagnose, picking, detail,
          nb: o.nb === true,
          exRules: Array.isArray(o.ex) ? o.ex.length : 0,
          exHits, willCollapse,
          collapsed: folded.length
        });
        return;
      });
      return true;   // 비동기 응답이므로 채널을 열어둔다
    }
    if (msg?.type === "PICK_START") {
      sendResponse({ ok: state.diagnose ? startPicker() : false });
    }
    if (msg?.type === "PICK_STOP") {
      stopPicker();
      sendResponse({ ok: true });
    }
  });
})();
