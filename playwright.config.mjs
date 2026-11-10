import { defineConfig } from "@playwright/test";

// 확장은 한 브라우저 프로필에 올라가므로 테스트끼리 프로필을 나누고 병렬로 돌리지 않는다.
export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,
  timeout: 30_000,
  reporter: [["list"]]
});
