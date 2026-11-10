// adtest 기준값 — legacy NOTES i-10 의 등록 상태로 2단계 채점을 읽어 adtest/baseline.json 에 남긴다
import fs from "node:fs";
import path from "node:path";
import { test, expect, ORIGIN } from "../e2e/fixtures.mjs";

const DIR = path.resolve("adtest");
const PAGE = path.join(DIR, "adtest.html");
const OUT = path.join(DIR, "baseline.json");
const VERSION = JSON.parse(fs.readFileSync(path.resolve("src/manifest.json"), "utf8")).version;

// i-10 A 의 등록. 텍스트 규칙은 이 순서가 E13 의 판정 근거다
const SITE = {
  ex: [".keep-grp"],
  selectors: ["#chk-both"],
  texts: [
    { scope: "div", word: "광고문의" },
    { scope: ".chk-scope-b", word: "제휴안내" },
    { scope: ".chk-scope-c", word: "이벤트", not: ["당첨자"] }
  ]
};

// i-10 B 의 채점 기준값 (v1.16.2 실측). 진단 켬은 출처 표시, 꺼짐은 접힘만 본다. 진단 꺼짐의 텍스트
// 적중은 흔적을 남기지 않아(D044) 페이지가 셀 수 없고, 접힘은 계산된 값으로 센다
const EXPECT = {
  "생성분 없음 · 진단 꺼짐": { score: "75·0·0·0", text: 0, collapsed: 7 },
  "생성분 없음 · 진단 켬": { score: "75·0·0·0", base: 19, custom: 1, ex: 7, will: 5, text: 10, collapsed: 0 },
  "배너 500개 · 진단 꺼짐": { score: "75·0·0·0", text: 0, collapsed: 8 },
  "배너 500개 · 진단 켬": { score: "75·0·0·0", base: 386, custom: 1, ex: 7, will: 6, text: 10, collapsed: 0 }
};

// 채점 줄과 표시 건수 줄을 읽는다
async function score(page) {
  // 스캔이 끝나 표시 건수가 300ms 간격으로 두 번 같을 때까지 기다린다. 한 번에 1.5초를 쉬면
  // Edge 에서 끔 직후의 스캔이 늦게 돌아 채점이 어긋나는 일이 있었다 (작업 8, 원인 미확인)
  const now = () => page.evaluate(() => ["__uc_src_base", "__uc_texthit"]
    .map((c) => document.querySelectorAll("." + c).length).join() + "," + [...document.querySelectorAll("*")]
    .filter((e) => { const s = getComputedStyle(e); return s.overflow === "hidden" && s.height === "0px"; }).length);
  let prev = "";
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(300);
    const cur = await now();
    if (i > 0 && cur === prev) break;
    prev = cur;
  }
  await page.click("#chk-run");
  const summary = await page.locator("#chk-summary").textContent();
  const sheets = await page.locator("#chk-sheets").textContent();
  const m = summary.match(/통과 (\d+) · 실패 (\d+) · 수동 (\d+) · 보류 (\d+)/);
  const n = (k) => Number(sheets.match(new RegExp(`${k} (\\d+)`))[1]);
  return {
    summary,
    score: m ? m.slice(1).join("·") : null,
    base: n("base"), custom: n("custom"), ex: n("ex"), will: n("will"), text: n("text"), collapsed: n("접힘")
  };
}

test("adtest 2단계 채점 기준값", async ({ context, store, diag }) => {
  if (!fs.existsSync(PAGE)) console.log("adtest/adtest.html 이 없어 건너뜁니다 (git 제외 로컬 파일)");
  test.skip(!fs.existsSync(PAGE), "adtest/adtest.html 없음");

  // adtest 폴더의 파일을 ORIGIN/adtest/ 아래에 응답한다
  await context.route(`${ORIGIN}/adtest/**`, (route) => {
    const f = path.join(DIR, path.basename(new URL(route.request().url()).pathname));
    if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({ contentType: "text/html; charset=utf-8", body: fs.readFileSync(f) });
  });
  await store.set({ "s:uc.test": SITE });
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/adtest/adtest.html`);
  await page.click("#chk-stage");
  await expect(page.locator("#chk-stage")).toHaveText("2단계 채점 켜짐");

  const got = {};
  for (const bulk of [false, true]) {
    const tag = bulk ? "배너 500개" : "생성분 없음";
    if (bulk) await page.click("#chk-bulk");
    await diag(page, false);
    got[`${tag} · 진단 꺼짐`] = await score(page);
    await diag(page, true);
    got[`${tag} · 진단 켬`] = await score(page);
  }
  await page.click("#chk-clear");

  fs.writeFileSync(OUT, JSON.stringify({ version: VERSION, date: new Date().toISOString(), site: SITE, results: got }, null, 2) + "\n");
  console.log(`adtest 결과를 ${path.relative(process.cwd(), OUT)} 에 저장했습니다`);

  for (const [k, exp] of Object.entries(EXPECT)) expect.soft(got[k], k).toMatchObject(exp);
});
