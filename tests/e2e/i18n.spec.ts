import { expect, test } from "@playwright/test";

test.describe("language", () => {
  test("Korean is the default for a new visitor", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "AOP Inbox에 로그인" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "ko");
    await context.close();
  });

  test("settings switches between 한국어 and English and remembers it", async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "aop-locale", value: "ko", url: baseURL! }]);
    await page.goto("/settings");
    const picker = page.getByRole("radiogroup", { name: "언어" });
    await picker.getByRole("radio", { name: "English" }).click();
    await expect(page.getByRole("radiogroup", { name: "Language" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("radiogroup", { name: "Language" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await page.getByRole("radio", { name: "한국어" }).click();
    await expect(page.getByRole("radiogroup", { name: "언어" })).toBeVisible();
  });
});
