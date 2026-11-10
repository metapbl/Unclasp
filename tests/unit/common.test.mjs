import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// common.js 는 모듈이 아니라 페이지·워커에 그대로 싣는 스크립트다. 같은 방식으로 문맥에 올린다
const SRC = readFileSync("src/common.js", "utf8");
const ctx = vm.createContext({ URL });
vm.runInContext(SRC, ctx);
const { hasContent, hostFromUrl, stable, riskyRegex } = ctx;

test("콘텐츠 스크립트가 다시 주입돼 두 번 읽혀도 오류가 없다", () => {
  assert.doesNotThrow(() => vm.runInContext(SRC, ctx));
});

test("hasContent: 기능 플래그는 boolean 일 때만, nb 는 true 일 때만 내용이다", () => {
  assert.equal(hasContent({ banner: false }), true);
  assert.equal(hasContent({ back: true }), true);
  assert.equal(hasContent({ banner: "false" }), false);
  assert.equal(hasContent({ banner: null }), false);
  assert.equal(hasContent({ nb: true }), true);
  assert.equal(hasContent({ nb: false }), false);
});

test("hasContent: 배열은 쓸 만한 문자열이 있어야 하고, texts 는 word 가 있는 규칙이 있어야 한다", () => {
  assert.equal(hasContent({ ex: [".keep"] }), true);
  assert.equal(hasContent({ selectors: ["#a"] }), true);
  assert.equal(hasContent({ selectors: ["", "  "] }), false);
  assert.equal(hasContent({ ex: [] }), false);
  assert.equal(hasContent({ texts: [{ scope: "div", word: "광고" }] }), true);
  assert.equal(hasContent({ texts: [{ scope: "div", word: " " }, "광고", null] }), false);
});

test("hasContent: 객체가 아니거나 모르는 키만 있으면 빈 항목이다", () => {
  for (const v of [undefined, null, "s", 1, {}, { foo: 1 }]) assert.equal(hasContent(v), false, String(v));
});

test("hostFromUrl: http·https 만 호스트를 돌려준다 (R§4 T4)", () => {
  assert.equal(hostFromUrl("https://news.example.com/a?b#c"), "news.example.com");
  assert.equal(hostFromUrl("http://uc.test:8080/"), "uc.test");
  for (const u of ["chrome://extensions", "about:blank", "file:///C:/a.html", "moz-extension://x/options.html", "아무거나", "", undefined]) {
    assert.equal(hostFromUrl(u), "", String(u));
  }
});

test("stable: 객체 키 순서와 무관하고 배열 순서는 지킨다", () => {
  assert.equal(stable({ scope: "div", word: "a", not: ["x"] }), stable({ not: ["x"], word: "a", scope: "div" }));
  assert.equal(stable({ a: { y: 1, x: 2 } }), stable({ a: { x: 2, y: 1 } }));
  assert.notEqual(stable({ s: ["a", "b"] }), stable({ s: ["b", "a"] }));
  assert.equal(stable(undefined), undefined);
});

// D019: 반복 기호가 붙은 묶음 안에 다시 반복 기호가 있으면 거절한다 (PRD F2 위험 패턴 판정)
test("riskyRegex: 반복이 겹친 묶음은 위험으로 본다", () => {
  for (const s of ["(a+)+$", "(a*)*", "(\\w+\\s?)*", "(a{2,})+", "(?:a+)+", "((ab)+)*", "(a+){2,}"])
    assert.equal(riskyRegex(s), true, s);
});

test("riskyRegex: 겹치지 않은 반복, 이스케이프·문자 집합 안의 기호는 위험이 아니다", () => {
  for (const s of ["a+b+", "(ab)+", "광고|협찬", "(a|b)*", "(a+)", "(a+)?", "(a+){2}", "(a+){1,3}",
    "(\\+)+", "([+*])+", "(a\\*)*", "ad\\d+ sale"])
    assert.equal(riskyRegex(s), false, s);
});
