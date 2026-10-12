import { expect, test as setup } from "@playwright/test";

export const STORAGE_STATE = "tests/e2e/.auth/user.json";

// Sign in once; Better Auth rate-limits sign-in (as it should), so specs reuse this session.
setup("sign in", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(process.env.DEV_USER_EMAIL ?? "dev@aop.local");
  await page.getByLabel("Password").fill(process.env.DEV_USER_PASSWORD ?? "aop-dev-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Your knowledge/ })).toBeVisible();
  await page.context().storageState({ path: STORAGE_STATE });
});
