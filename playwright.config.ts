import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3000);

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.ts",
  timeout: 60_000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    colorScheme: "dark",
  },
  projects: [
    { name: "setup", testMatch: "**/*.setup.ts" },
    {
      name: "desktop",
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, storageState: "tests/e2e/.auth/user.json" },
    },
    { name: "mobile", dependencies: ["setup"], use: { ...devices["Pixel 7"], storageState: "tests/e2e/.auth/user.json" } },
  ],
  // Uses the dev server + dev database (run `pnpm bootstrap` first). Tests clean up what they create.
  webServer: { command: "pnpm dev", url: `http://localhost:${PORT}/login`, reuseExistingServer: true, timeout: 120_000 },
});
