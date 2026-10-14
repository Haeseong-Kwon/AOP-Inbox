import { expect, test } from "@playwright/test";

test("the shulker opens while you type and the hotbar opens slots with 1–9", async ({ page }) => {
  await page.goto("/");
  const shulker = page.locator("header svg.shulker");
  await expect(shulker).toBeVisible();
  await page.getByPlaceholder(/Paste anything/).click();
  await expect(shulker).toHaveAttribute("data-mood", "open");

  const firstSlot = page.getByRole("region", { name: "Hotbar" }).getByRole("link").first();
  const href = await firstSlot.getAttribute("href");
  await page.locator("h1").click(); // leave the textarea so number keys reach the hotbar
  await page.keyboard.press("1");
  await expect(page).toHaveURL((url) => url.pathname + url.search === href);
});
