// F3 빈 컨테이너 접기 — v1.17.0 동작 고정 (특성 테스트, D022)
import { test, expect } from "./fixtures.mjs";

const WILL = /__uc_will_collapse/;
const height = (page, sel) => page.locator(sel).evaluate((el) => el.getBoundingClientRect().height);
// 접히면 안쪽 여백까지 0 이 된다. 접힘 표시 클래스는 흔적이라 붙이지 않는다 (D044)
const PAD = `style="padding:5px"`;

test.describe("F3 빈 컨테이너 접기", () => {
  test("자식이 숨긴 배너 하나뿐인 부모는 높이 0 으로 접힌다", async ({ open }) => {
    const page = await open(
      `<div id="p" style="padding:10px;border:1px solid #000;min-height:40px"><div class="ad-banner">광고</div></div><p>본문</p>`);
    await expect.poll(() => height(page, "#p")).toBe(0);
  });

  test("부모가 자체 글자를 가지면 접히지 않는다", async ({ open }) => {
    const page = await open(`<div id="p">글자<div class="ad-banner">광고</div></div>`);
    await expect(page.locator(".ad-banner")).toBeHidden();
    await page.waitForTimeout(400);
    expect(await height(page, "#p")).toBeGreaterThan(0);
  });

  test("보이는 형제가 있으면 접히지 않는다", async ({ open }) => {
    const page = await open(`<div id="p"><div class="ad-banner">광고</div><span>보임</span></div>`);
    await expect(page.locator(".ad-banner")).toBeHidden();
    await page.waitForTimeout(400);
    expect(await height(page, "#p")).toBeGreaterThan(0);
  });

  test("부모 3단계까지만 접는다", async ({ open }) => {
    const page = await open(
      `<div id="d1" ${PAD}><div id="d2" ${PAD}><div id="d3" ${PAD}><div id="d4" ${PAD}><div class="ad-banner">광고</div></div></div></div></div>`);
    await expect.poll(() => height(page, "#d2")).toBe(0);
    expect(await height(page, "#d3")).toBe(0);
    expect(await height(page, "#d4")).toBe(0);
    expect(await height(page, "#d1")).toBe(10);
  });

  test("section 같은 보존 태그는 접지 않는다", async ({ open }) => {
    const page = await open(`<section id="s" ${PAD}><div class="ad-banner">광고</div></section>`);
    await expect(page.locator(".ad-banner")).toBeHidden();
    await page.waitForTimeout(400);
    expect(await height(page, "#s")).toBe(10);
  });

  test("진단 모드에서는 접지 않고 접힘 예정으로 표시만 한다", async ({ open, diag }) => {
    const page = await open(`<div id="p" style="min-height:40px"><div class="ad-banner">광고</div></div>`);
    await expect.poll(() => height(page, "#p")).toBe(0);
    await diag(page, true);
    await expect(page.locator("#p")).toHaveClass(WILL);
    expect(await height(page, "#p")).toBeGreaterThan(0);
  });

  test("배너 숨기기를 끄면 접지 않는다", async ({ open, store }) => {
    await store.set({ "s:uc.test": { banner: false } });
    const page = await open(`<div id="p" style="min-height:40px"><div class="ad-banner">광고</div></div>`);
    await page.waitForTimeout(400);
    expect(await height(page, "#p")).toBeGreaterThan(0);
  });
});
