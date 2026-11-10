import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// PRD §2.4: 권한을 늘리지 않는다
test("manifest 권한이 storage·activeTab·scripting 과 <all_urls> 콘텐츠 스크립트뿐이다", () => {
  const m = JSON.parse(readFileSync("src/manifest.json", "utf8"));
  assert.deepEqual([...m.permissions].sort(), ["activeTab", "scripting", "storage"]);
  assert.equal(m.host_permissions, undefined);
  assert.equal(m.optional_permissions, undefined);
  assert.deepEqual(m.content_scripts.map((c) => c.matches), [["<all_urls>"]]);
});

// D043: A 는 Chrome·토르, S 는 Firefox·토르 메뉴 막대 "기록" 과 겹쳐 P·C 로 옮겼다 (REFERENCE R§2)
test("단축키가 Alt+Shift+O·C·X·Z 다", () => {
  const m = JSON.parse(readFileSync("src/manifest.json", "utf8"));
  const keys = Object.fromEntries(Object.entries(m.commands).map(([k, v]) => [k, v.suggested_key.default]));
  assert.deepEqual(keys, {
    _execute_action: "Alt+Shift+O",
    "start-picker": "Alt+Shift+C",
    "toggle-diagnose": "Alt+Shift+X",
    "toggle-banner": "Alt+Shift+Z",
  });
});

// D018: manifest 하나를 Chrome·Firefox(토르) 가 함께 쓴다
test("manifest 가 Chrome 과 Firefox 를 함께 지원한다", () => {
  const m = JSON.parse(readFileSync("src/manifest.json", "utf8"));
  assert.deepEqual(m.browser_specific_settings, { gecko: { id: "unclasp@localhost", strict_min_version: "128.0" } });
  // Chrome 은 background.scripts 가 있으면 "requires manifest version of 2 or lower" 오류를 띄운다.
  // 원본에는 두지 않고 빌드가 xpi 안의 manifest 에만 넣는다 (scripts/build.ps1)
  assert.deepEqual(m.background, { service_worker: "background.js" });
  assert.deepEqual(m.options_ui, { page: "options.html", open_in_tab: true });
  assert.equal(m.options_page, undefined);
  assert.deepEqual(m.content_scripts[0].js, ["common.js", "content.js"]);
});

// D062: 이름은 Unclasp. 보이는 이름과 툴바 제목이 같다
test("확장 이름과 툴바 제목이 Unclasp 이다", () => {
  const m = JSON.parse(readFileSync("src/manifest.json", "utf8"));
  assert.equal(m.name, "Unclasp");
  assert.equal(m.action.default_title, "Unclasp");
});
