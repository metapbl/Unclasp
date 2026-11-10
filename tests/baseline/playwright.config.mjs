import { defineConfig } from "@playwright/test";

// adtest 는 git 에 없는 로컬 페이지라(.gitignore 의 adtest/ 를 피해 폴더 이름을 baseline 으로 둔다) npm test 와 따로 돌린다 (npm run adtest)
export default defineConfig({
  testDir: ".",
  workers: 1,
  timeout: 60_000,
  reporter: [["list"]]
});
