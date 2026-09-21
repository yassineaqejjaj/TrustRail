import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./specs",
  timeout: 30_000,
  fullyParallel: false, // shares one backend stack; keep it simple and deterministic
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  globalSetup: "./global-setup.ts",
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      // Every existing spec plus every new one except responsive.spec.ts,
      // at the same default (desktop) viewport as before this project
      // split was introduced.
      name: "desktop-chromium",
      testIgnore: /responsive\.spec\.ts/,
    },
    {
      // A plain 375x812 mobile viewport (docs/ROADMAP.md item 9), scoped
      // to responsive.spec.ts only so nothing else runs twice.
      name: "mobile-chromium",
      testMatch: /responsive\.spec\.ts/,
      use: { viewport: { width: 375, height: 812 } },
    },
  ],
});
