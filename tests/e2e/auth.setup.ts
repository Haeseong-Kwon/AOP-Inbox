import { expect, test as setup } from "@playwright/test";

export const STORAGE_STATE = "tests/e2e/.auth/user.json";

// Sign in once; Better Auth rate-limits sign-in (as it should), so specs reuse this session.
// The existing specs assert English copy; Korean (the default) is covered by i18n.spec.ts.
setup("sign in", async ({ page, baseURL }) => {
  await page.context().addCookies([{ name: "aop-locale", value: "en", url: baseURL! }]);
  await page.goto("/login");
  await page.getByLabel("Email").fill(process.env.DEV_USER_EMAIL ?? "dev@aop.local");
  await page.getByLabel("Password").fill(process.env.DEV_USER_PASSWORD ?? "aop-dev-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Toss it in the shulker box/ })).toBeVisible();
  await page.context().storageState({ path: STORAGE_STATE });
});
