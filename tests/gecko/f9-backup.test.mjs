// F9 백업·복구 — Firefox ESR·토르 인수 테스트 (D040)
import { test } from "node:test";
import assert from "node:assert/strict";
import { suite, store, ext, upload, downloaded, dialog, poll, text, EXT_ORIGIN } from "./gecko.mjs";

const SITES = {
  "s:a.test": { banner: false, selectors: ["#ad"] },
  "s:b.test": { ex: [".keep"], texts: [{ scope: "div", word: "광고", not: ["광고문의"] }] }
};

suite("F9 백업·복구", (t) => {
  const options = async () => {
    await t.driver.get(`${EXT_ORIGIN}/options.html`);
    await poll(async () => (await text(t.driver, "#quota"))?.length);
  };
  const msg = () => text(t.driver, "#msg");
  const msgHas = (s) => poll(async () => (await msg())?.includes(s));
  // 저장소를 읽으려면 옵션 탭을 벗어나야 하므로 확장 페이지에서 바로 읽는다
  const all = () => t.driver.executeAsyncScript("browser.storage.local.get(null).then(arguments[0])");

  test("지금 설정을 파일로 저장해 바로 복구하면 미리보기가 사이트 설정 변경 없음", async () => {
    await store(t.driver).set(SITES);
    await options();
    await (await t.driver.findElement({ css: "#saveFile" })).click();
    const { name, json } = await downloaded();
    assert.match(name, /^settings-backup-\d{4}-\d{2}-\d{2}\.json$/);
    assert.deepEqual(json.sites, { "a.test": SITES["s:a.test"], "b.test": SITES["s:b.test"] });

    await upload(t.driver, json);
    assert.equal(await dialog(t.driver, true), "settings-backup.json 의 내용으로 설정을 바꿉니다.\n\n사이트 설정 변경 없음\n\n계속할까요?");
    assert.ok(await msgHas("복구했습니다"), await msg());
  });

  test("교체·추가·삭제 건수가 나오고 삭제될 사이트는 호스트 이름도 나온다", async () => {
    await store(t.driver).set(SITES);
    await options();
    const json = { global: {}, sites: { "a.test": { banner: true }, "b.test": SITES["s:b.test"], "new.test": { copy: true } } };
    await ext(t.driver, `() => browser.storage.local.remove("s:b.test")`);
    await store(t.driver).set({ "s:c.test": { copy: true } });
    await upload(t.driver, json);
    assert.equal(await dialog(t.driver, true), "settings-backup.json 의 내용으로 설정을 바꿉니다.\n\n" +
      "추가 2개 · 교체 1개 · 삭제 1개\n\n삭제될 사이트: c.test\n\n계속할까요?");
    assert.ok(await msgHas("복구했습니다"), await msg());
    const a = await all();
    assert.deepEqual(a["s:a.test"], { banner: true });
    assert.equal(a["s:c.test"], undefined);
  });

  test("정규식 규칙 3개 중 1개가 위험 패턴이면 미리보기에 줄이 따로 나오고 복구 뒤 정규식 규칙은 2개다 (D019)", async () => {
    await options();
    await upload(t.driver, { global: {}, sites: { "r.test": { texts: [
      { scope: "div", word: "ad\\d+", m: "re" },
      { scope: "div", word: "(a+)+$", m: "re" },
      { scope: "div", word: "협찬|광고", m: "re" }
    ] } } });
    assert.equal(await dialog(t.driver, true), "settings-backup.json 의 내용으로 설정을 바꿉니다.\n\n추가 1개\n" +
      "정규식 규칙 2개 포함, 위험 패턴 1개 버림\n\n계속할까요?");
    assert.ok(await msgHas("복구했습니다"), await msg());
    assert.deepEqual((await all())["s:r.test"].texts.map((r) => r.word), ["ad\\d+", "협찬|광고"]);
  });

  for (const [what, content, expect] of [
    ["1MB 를 넘는 파일", Buffer.alloc(1024 * 1024 + 1, 32), "파일이 너무 큽니다. 설정 백업 파일인지 확인하십시오."],
    ["JSON 이 아닌 파일", "{ global: ", "JSON 형식이 잘못되었습니다: "],
  ]) test(`${what}은 확인창 없이 거절하고 설정은 그대로다`, async () => {
    await store(t.driver).set(SITES);
    await options();
    await upload(t.driver, content);
    assert.ok(await msgHas(expect), await msg());
    assert.equal(await dialog(t.driver, true, 300), null);
    const a = await all();
    assert.deepEqual({ "s:a.test": a["s:a.test"], "s:b.test": a["s:b.test"] }, SITES);
  });
});
