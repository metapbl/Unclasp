import { defineConfig } from "@playwright/test";

// README 스크린샷 생성 (D100~D104). 검사가 아니라 이미지를 쓰므로 npm test 와 따로 돌린다 (npm run screens)
export default defineConfig({
  testDir: ".",
  workers: 1,
  timeout: 120_000,
  reporter: [["list"]]
});
