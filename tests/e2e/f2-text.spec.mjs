// F2 텍스트 규칙 — v1.17.0 동작 고정 (특성 테스트, D022)
import { test, expect } from "./fixtures.mjs";

const KEY = "s:uc.test";
// 텍스트 적중 클래스는 진단 모드에서만 붙는다 (D044). 평소에는 계산된 display 로 본다
const display = (page, sel) => page.locator(sel).evaluate((el) => getComputedStyle(el).display);
// 텍스트 규칙은 가로 80px·세로 30px 이상인 요소만 잡는다
const BOX = `style="min-height:40px"`;
const rule = (texts, extra = {}) => ({ [KEY]: { texts, ...extra } });

test.describe("F2 텍스트 규칙", () => {
  test("세 겹이 모두 낱말을 품으면 가장 안쪽 div 하나만 숨는다", async ({ open, store }) => {
    await store.set(rule([{ scope: "div", word: "광고" }]));
    const page = await open(
      `<div id="o" ${BOX}><div id="m" ${BOX}><div id="i" ${BOX}>광고</div></div></div>`);
    await expect(page.locator("#i")).toBeHidden();
    expect(await display(page, "#m")).toBe("block");
    expect(await display(page, "#o")).toBe("block");
  });

  test("제외 단어가 들어 있으면 낱말이 함께 있어도 숨기지 않는다", async ({ open, store }) => {
    await store.set(rule([{ scope: "div", word: "광고", not: ["광고문의"] }]));
    const page = await open(`<div id="x" ${BOX}>광고문의 02-123</div><div id="y" ${BOX}>광고</div>`);
    await expect(page.locator("#y")).toBeHidden();
    await expect(page.locator("#x")).toBeVisible();
  });

  test("nav·footer 안쪽과, nav 를 자손으로 품은 요소는 잡지 않는다", async ({ open, store }) => {
    await store.set(rule([{ scope: "div", word: "광고" }]));
    const page = await open(
      `<nav><div id="n" ${BOX}>광고</div></nav><footer><div id="f" ${BOX}>광고</div></footer>` +
      `<div id="d" ${BOX}>광고<nav>메뉴</nav></div><div id="y" ${BOX}>광고</div>`);
    await expect(page.locator("#y")).toBeHidden();
    await expect(page.locator("#n")).toBeVisible();
    await expect(page.locator("#f")).toBeVisible();
    await expect(page.locator("#d")).toBeVisible();
  });

  test("완전 일치는 공백을 정리한 글자 전체가 낱말과 같을 때만 잡는다", async ({ open, store }) => {
    await store.set(rule([{ scope: "div", word: "광고", m: "eq" }]));
    const page = await open(`<div id="a" ${BOX}>  광고  </div><div id="b" ${BOX}>광고 문의</div>`);
    await expect(page.locator("#a")).toBeHidden();
    await expect(page.locator("#b")).toBeVisible();
  });

  test("정규식 방식은 대소문자를 구별하지 않고 패턴에 맞는 요소를 잡는다", async ({ open, store }) => {
    await store.set(rule([{ scope: "div", word: "AD\\d", m: "re" }]));
    const page = await open(`<div id="a" ${BOX}>ad7 sale</div><div id="b" ${BOX}>ad sale</div>`);
    await expect(page.locator("#a")).toBeHidden();
    await expect(page.locator("#b")).toBeVisible();
  });

  test("포함 방식도 대소문자를 구별하지 않는다", async ({ open, store }) => {
    await store.set(rule([{ scope: "div", word: "SPONSORED" }]));
    const page = await open(`<div id="a" ${BOX}>Sponsored link</div>`);
    await expect(page.locator("#a")).toBeHidden();
  });

  test("문법 오류·빈 글자에 맞는·100자 초과 정규식 규칙은 무시된다", async ({ open, store }) => {
    await store.set(rule([
      { scope: "div", word: "(", m: "re" },
      { scope: "div", word: "x*", m: "re" },
      { scope: "div", word: "광".repeat(101), m: "re" },
      { scope: "div", word: "남김" }
    ]));
    const page = await open(`<div id="a" ${BOX}>아무 글자</div><div id="b" ${BOX}>남김</div>`);
    await expect(page.locator("#b")).toBeHidden();
    await expect(page.locator("#a")).toBeVisible();
  });

  test("200자를 넘는 요소와 80×30px 보다 작은 요소는 잡지 않는다", async ({ open, store }) => {
    await store.set(rule([{ scope: "div", word: "광고" }]));
    const long = "광고" + "가".repeat(200);
    const page = await open(
      `<div id="l" ${BOX}>${long}</div>` +
      `<div id="s" style="width:50px;height:20px">광고</div>` +
      `<div id="y" ${BOX}>광고</div>`);
    await expect(page.locator("#y")).toBeHidden();
    await expect(page.locator("#l")).toBeVisible();
    await expect(page.locator("#s")).toBeVisible();
  });

  test("범위 선택자 안의 요소만 잡는다", async ({ open, store }) => {
    await store.set(rule([{ scope: ".box", word: "광고" }]));
    const page = await open(`<div class="box" id="a" ${BOX}>광고</div><div id="b" ${BOX}>광고</div>`);
    await expect(page.locator("#a")).toBeHidden();
    await expect(page.locator("#b")).toBeVisible();
  });

  test("범위에 맞는 요소를 4,000개까지만 검사한다", async ({ open, store }) => {
    await store.set(rule([{ scope: "div", word: "광고" }]));
    // 대조: 상한 안쪽(3,999번째 뒤)이면 잡힌다
    const near = await open(`${"<div></div>".repeat(3999)}<div id="in" ${BOX}>광고</div>`, "/near");
    await expect(near.locator("#in")).toBeHidden();
    const page = await open(`${"<div></div>".repeat(4000)}<div id="late" ${BOX}>광고</div>`);
    await page.waitForTimeout(600);
    await expect(page.locator("#late")).toBeVisible();
  });

  test("사이트 예외에 든 요소는 잡지 않는다", async ({ open, store }) => {
    await store.set(rule([{ scope: "div", word: "광고" }], { ex: [".keep"] }));
    const page = await open(`<div class="keep"><div id="k" ${BOX}>광고</div></div><div id="y" ${BOX}>광고</div>`);
    await expect(page.locator("#y")).toBeHidden();
    await expect(page.locator("#k")).toBeVisible();
  });

  test("배너 숨기기를 끄면 텍스트 규칙도 동작하지 않는다", async ({ open, store }) => {
    await store.set(rule([{ scope: "div", word: "광고" }], { banner: false }));
    const page = await open(`<div id="y" ${BOX}>광고</div>`);
    await page.waitForTimeout(600);
    await expect(page.locator("#y")).toBeVisible();
  });

  test("진단 모드에서는 숨기지 않고, 배지 문구에 범위·방식·낱말·제외 단어를 적는다", async ({ open, store, diag }) => {
    await store.set(rule([
      { scope: "div", word: "광고", not: ["광고문의"] },
      { scope: ".eq", word: "협찬", m: "eq" },
      { scope: ".re", word: "PR\\d", m: "re" }
    ]));
    const page = await open(
      `<div id="a" ${BOX}>광고</div><div class="eq" id="b" ${BOX}>협찬</div><div class="re" id="c" ${BOX}>PR1</div>`);
    await expect(page.locator("#a")).toBeHidden();
    await diag(page, true);
    await expect(page.locator("#a")).toBeVisible();
    await expect(page.locator("#a")).toHaveAttribute("data-uc-why", `텍스트 · div ⊃ "광고" − "광고문의"`);
    await expect(page.locator("#b")).toHaveAttribute("data-uc-why", `텍스트 · .eq = "협찬"`);
    await expect(page.locator("#c")).toHaveAttribute("data-uc-why", `텍스트 · .re ~ "PR\\d"`);
  });

  test("같은 요소가 두 규칙에 걸리면 먼저 등록한 규칙의 배지가 남는다", async ({ open, store, diag }) => {
    await store.set(rule([{ scope: "div", word: "광고" }, { scope: ".b", word: "제휴" }]));
    const page = await open(`<div class="b" id="a" ${BOX}>광고 제휴</div>`);
    await expect(page.locator("#a")).toBeHidden();
    await diag(page, true);
    await expect(page.locator("#a")).toHaveAttribute("data-uc-why", `텍스트 · div ⊃ "광고"`);
  });

  test("완전 일치 규칙에 저장된 제외 단어는 무시된다", async ({ open, store }) => {
    await store.set(rule([{ scope: "div", word: "광고", m: "eq", not: ["광고"] }]));
    const page = await open(`<div id="a" ${BOX}>광고</div>`);
    await expect(page.locator("#a")).toBeHidden();
  });
});

test.describe("PRD §2.2 스캔 굶주림 (ANALYSIS A1)", () => {
  test("DOM 이 50ms 마다 바뀌는 페이지에서도 1초 안에 텍스트 규칙에 걸린 요소가 숨는다", async ({ open, store }) => {
    await store.set(rule([{ scope: "div", word: "광고" }]));
    const page = await open(
      `<div id="t" ${BOX}>광고</div><ul id="feed"></ul>` +
      `<script>setInterval(() => document.getElementById("feed").append(document.createElement("li")), 50);</script>`);
    await page.waitForTimeout(1000);
    await expect(page.locator("#t")).toBeHidden({ timeout: 1 });
  });
});

// D019: 반복이 겹친 정규식은 입력에서 거절한다
test("옵션의 텍스트 규칙 폼에 위험 정규식을 넣으면 오류를 알리고 입력칸에 포커스가 가며 저장되지 않는다", async ({ context, extensionId, store }) => {
  const p = await context.newPage();
  await p.goto(`chrome-extension://${extensionId}/options.html`);
  await p.fill("#tHost", "uc.test");
  await p.fill("#tWord", "(a+)+$");
  await p.selectOption("#tMode", "re");
  await p.press("#tWord", "Enter");
  await expect(p.locator("#msg")).toContainText("위험한 정규식");
  await expect(p.locator("#msg")).toHaveClass(/err/);
  await expect(p.locator("#tWord")).toBeFocused();
  expect(await store.get(KEY)).toEqual({});
});
