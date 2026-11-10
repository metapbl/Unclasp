import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["node_modules/", "test-results/", "playwright-report/", "dist/", "adtest/"] },
  js.configs.recommended,
  {
    files: ["src/**/*.js"],
    languageOptions: {
      sourceType: "script",
      globals: { ...globals.browser, ...globals.webextensions, ...globals.serviceworker }
    },
  },
  {
    // common.js 가 정의하고 나머지 파일이 쓴다
    files: ["src/**/*.js"],
    ignores: ["src/common.js"],
    languageOptions: {
      globals: {
        SITE_PREFIX: "readonly", FLAG_KEYS: "readonly", DEFAULT_GLOBAL: "readonly",
        hostFromUrl: "readonly", hasContent: "readonly", stable: "readonly", riskyRegex: "readonly"
      }
    }
  },
  {
    files: ["tests/**/*.mjs", "*.mjs"],
    languageOptions: { globals: { ...globals.node } },
    // Playwright fixture 는 첫 인자로 빈 구조 분해 `{}` 를 쓴다
    rules: { "no-empty-pattern": "off" }
  },
  {
    // e2e 테스트는 page.evaluate·worker.evaluate 안에서 페이지와 확장 API 를 쓴다
    files: ["tests/e2e/**/*.mjs", "tests/baseline/**/*.mjs"],
    languageOptions: { globals: { ...globals.node, ...globals.browser, ...globals.webextensions } }
  }
];
