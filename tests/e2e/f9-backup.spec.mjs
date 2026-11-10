// F9 백업·복구 — v1.17.0 동작 고정 (특성 테스트, D022)
import { test, expect } from "./fixtures.mjs";

const SITES = {
  "s:a.test": { banner: false, selectors: ["#ad"] },
  "s:b.test": { ex: [".keep"], texts: [{ scope: "div", word: "광고", not: ["광고문의"] }] }
};

// 옵션 페이지를 열고, 확인창 문구를 모으며 accept 로 답한다
async function options(context, extensionId, accept = true) {
  const p = await context.newPage();
  const asked = [];
  p.on("dialog", (d) => { asked.push(d.message()); accept ? d.accept() : d.dismiss(); });
  await p.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(p.locator("#quota")).not.toBeEmpty();
  return { p, asked };
}
// 저장은 Blob 주소를 단 a[download] 를 눌러 내려받는다. 그 클릭을 가로채 이름과 내용을 읽는다
async function save(p) {
  await p.evaluate(() => {
    const click = HTMLAnchorElement.prototype.click;
    window.saved = new Promise((done) => {
      HTMLAnchorElement.prototype.click = function () {
        HTMLAnchorElement.prototype.click = click;
        fetch(this.href).then((r) => r.text()).then((text) => done({ name: this.download, text }));
      };
    });
  });
  await p.click("#saveFile");
  const { name, text } = await p.evaluate(() => window.saved);
  return { name, json: JSON.parse(text) };
}
const restore = (p, content, name = "settings-backup.json") =>
  p.setInputFiles("#file", { name, mimeType: "application/json",
    buffer: Buffer.isBuffer(content) ? content : Buffer.from(typeof content === "string" ? content : JSON.stringify(content)) });
const msg = (p) => p.locator("#msg");

test.describe("F9 백업·복구", () => {
  test("파일로 저장하면 schema·global·sites 묶음이 되고, 바로 복구하면 변경 없음", async ({ context, extensionId, store }) => {
    await store.set(SITES);
    const { p, asked } = await options(context, extensionId);
    const { name, json } = await save(p);
    expect(name).toMatch(/^settings-backup-\d{4}-\d{2}-\d{2}\.json$/);
    expect(json).toEqual({
      schema: 2,
      global: { banner: true, rightclick: false, copy: false, back: true },
      sites: { "a.test": SITES["s:a.test"], "b.test": SITES["s:b.test"] }
    });
    await expect(msg(p)).toContainText("사이트 2개");

    await restore(p, json);
    await expect(msg(p)).toContainText("복구했습니다. 사이트 2개, 숨긴 항목 1건, 예외 1건, 텍스트 규칙 1건, 기본규칙 끔 0개.");
    expect(asked).toEqual(["settings-backup.json 의 내용으로 설정을 바꿉니다.\n\n사이트 설정 변경 없음\n\n계속할까요?"]);
    expect(await store.get()).toEqual({ global: json.global, ...SITES, schema: 2 });
  });

  test("값을 바꾼 사이트는 교체, 지운 사이트는 추가, 파일에 없는 사이트는 삭제로 센다", async ({ context, extensionId, store }) => {
    await store.set(SITES);
    const { p, asked } = await options(context, extensionId);
    const { json } = await save(p);
    // 저장 뒤: a 값을 바꾸고, b 를 지우고, c 를 새로 만든다
    await store.set({ "s:a.test": { banner: true } });
    await store.set({ "s:c.test": { copy: true } });
    await context.serviceWorkers()[0].evaluate(() => chrome.storage.local.remove("s:b.test"));

    await restore(p, json);
    await expect(msg(p)).toContainText("복구했습니다");
    expect(asked[0]).toBe("settings-backup.json 의 내용으로 설정을 바꿉니다.\n\n" +
      "추가 1개 · 교체 1개 · 삭제 1개\n\n삭제될 사이트: c.test\n\n계속할까요?");
    const all = await store.get();
    expect(all["s:a.test"]).toEqual(SITES["s:a.test"]);
    expect(all["s:b.test"]).toEqual(SITES["s:b.test"]);
    expect(all["s:c.test"]).toBeUndefined();
  });

  test("지금 값: 확인창에 호스트 이름은 삭제될 사이트만 나오고 5개를 넘으면 줄인다", async ({ context, extensionId, store }) => {
    const many = {};
    for (let i = 1; i <= 7; i++) many[`s:h${i}.test`] = { copy: true };
    await store.set(many);
    const { p, asked } = await options(context, extensionId);
    await restore(p, { global: {}, sites: { "new.test": { copy: true } } });
    await expect(msg(p)).toContainText("복구했습니다");
    expect(asked[0]).toContain("추가 1개 · 삭제 7개\n\n삭제될 사이트: h1.test, h2.test, h3.test, h4.test, h5.test 외 2개\n");
    expect(asked[0]).not.toContain("new.test");
  });

  test("확인창에서 취소하면 설정이 그대로다", async ({ context, extensionId, store }) => {
    await store.set(SITES);
    const { p } = await options(context, extensionId, false);
    await restore(p, { global: { banner: false }, sites: {} });
    await expect(msg(p)).toHaveText("복구를 취소했습니다.");
    expect(await store.get()).toEqual(SITES);
  });

  test.describe("거절", () => {
    const cases = [
      ["1MB 를 넘는 파일", Buffer.alloc(1024 * 1024 + 1, 32), "파일이 너무 큽니다. 설정 백업 파일인지 확인하십시오."],
      ["JSON 이 아닌 파일", "{ global: ", /^JSON 형식이 잘못되었습니다: /],
      ["객체가 아닌 JSON", "[1,2]", "설정 파일 형식이 아닙니다."],
      ["global·sites 가 없는 JSON", { foo: 1 }, "설정 내용을 찾지 못했습니다. global 과 sites 가 있어야 합니다."]
    ];
    for (const [what, content, text] of cases) {
      test(`${what}은 확인창 없이 거절하고 설정은 그대로다`, async ({ context, extensionId, store }) => {
        await store.set(SITES);
        const { p, asked } = await options(context, extensionId);
        await restore(p, content);
        await expect(msg(p)).toHaveText(text);
        await expect(msg(p)).toHaveClass(/err/);
        expect(asked).toEqual([]);
        expect(await store.get()).toEqual(SITES);
      });
    }
  });

  test("부분 수용: 모르는 키·잘못된 항목은 하나씩 버리고 나머지를 받으며 schema 값은 보지 않는다", async ({ context, extensionId, store }) => {
    const { p } = await options(context, extensionId);
    await restore(p, {
      schema: 99,
      extra: true,
      global: { banner: false, copy: "yes", zzz: 1 },
      sites: {
        "HTTPS://Good.Test/": {
          banner: true, rightclick: "no", nb: true, foo: 1,
          ex: [".keep", "", 3], selectors: ["#ad", "  ", null],
          texts: [
            { word: "광고", not: "광고문의", junk: 1 },
            { scope: "p", word: "  " },
            { word: "(", m: "re" },
            { word: ".*", m: "re" },
            { word: "a".repeat(101), m: "re" },
            { word: "^광고$", m: "re" },
            { word: "정확", m: "eq", not: ["무시"] },
            { word: "섞임", m: "zz", not: ["섞임", "a", "A", "b", "c", "d", "e", "f"] },
            "글자"
          ]
        },
        "empty.test": { foo: 1, nb: false },
        "bad.test": "문자열"
      }
    });
    await expect(msg(p)).toContainText("복구했습니다. 사이트 1개, 숨긴 항목 1건, 예외 1건, 텍스트 규칙 4건, 기본규칙 끔 1개.");
    expect(await store.get()).toEqual({
      schema: 2,
      global: { banner: false, rightclick: false, copy: false, back: true },
      "s:good.test": {
        banner: true, nb: true, ex: [".keep"], selectors: ["#ad"],
        texts: [
          { scope: "div", word: "광고", not: ["광고문의"] },
          { scope: "div", word: "^광고$", m: "re" },
          { scope: "div", word: "정확", m: "eq" },
          { scope: "div", word: "섞임", not: ["a", "b", "c", "d", "e"] }
        ]
      }
    });
  });

  test("최상위 s:<host> 키도 받고, sites 묶음과 겹치면 s: 키가 이긴다", async ({ context, extensionId, store }) => {
    const { p } = await options(context, extensionId);
    await restore(p, {
      sites: { "x.test": { copy: true }, "y.test": { back: false } },
      "s:x.test": { rightclick: true },
      "s:z.test": { banner: false }
    });
    await expect(msg(p)).toContainText("복구했습니다. 사이트 3개");
    const all = await store.get();
    expect(all["s:x.test"]).toEqual({ rightclick: true });
    expect(all["s:y.test"]).toEqual({ back: false });
    expect(all["s:z.test"]).toEqual({ banner: false });
    // global 이 없으면 기본값으로 쓴다
    expect(all.global).toEqual({ banner: true, rightclick: false, copy: false, back: true });
  });

  // D019: 위험 정규식 규칙은 버리고 미리보기에 따로 알린다
  test("정규식 규칙 3개 중 1개가 위험 패턴이면 미리보기에 줄이 따로 나오고 복구 뒤 정규식 규칙은 2개다", async ({ context, extensionId, store }) => {
    const { p, asked } = await options(context, extensionId);
    await restore(p, { global: {}, sites: { "r.test": { texts: [
      { scope: "div", word: "ad\\d+", m: "re" },
      { scope: "div", word: "(a+)+$", m: "re" },
      { scope: "div", word: "협찬|광고", m: "re" }
    ] } } });
    await expect(msg(p)).toContainText("복구했습니다");
    expect(asked[0]).toBe("settings-backup.json 의 내용으로 설정을 바꿉니다.\n\n추가 1개\n" +
      "정규식 규칙 2개 포함, 위험 패턴 1개 버림\n\n계속할까요?");
    expect((await store.get())["s:r.test"].texts.map((r) => r.word)).toEqual(["ad\\d+", "협찬|광고"]);
  });
});
