import { expect, test, type Page } from "@playwright/test";

async function openHome(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Toss it in the shulker box/ })).toBeVisible();
}

test("capture a note, find it in the inbox, open it, and search for it", async ({ page, isMobile }, testInfo) => {
  // Unique per worker: desktop and mobile run in parallel against the same database.
  const token = `zephyr${testInfo.project.name}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const note = `Idea ${token}: batch AI agents with worktrees for parallel feature work.`;
  await openHome(page);

  // Capture via the global shortcut (desktop) or the bottom-nav button (mobile).
  if (isMobile) await page.getByRole("button", { name: "Capture" }).last().click();
  else await page.keyboard.press("c");
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Link or note").fill(note);
  await dialog.getByLabel("Link or note").press("Enter");
  await expect(page.getByText("Stored in your shulker box")).toBeVisible();

  // It shows up in the inbox and finishes analysis in the background.
  await page.goto("/inbox?source=note");
  const row = page.locator("[data-item-id]").filter({ hasText: token }).first();
  await expect(row).toBeVisible();
  await expect(row.getByText("The shulker is reading it…")).toHaveCount(0, { timeout: 30_000 });

  // Open the detail panel / drawer.
  await row.click();
  const detail = page.locator("article[aria-labelledby=detail-title]");
  await expect(detail.locator("#detail-title")).toBeVisible();
  await expect(detail.getByRole("textbox", { name: "My note" })).toBeVisible();
  const itemId = new URL(page.url()).searchParams.get("item");
  expect(itemId).toBeTruthy();

  // Search finds it by a word from the note.
  await page.goto(`/search?q=${token}`);
  await expect(page.getByRole("link", { name: new RegExp(token) }).first()).toBeVisible();

  // Clean up.
  const res = await page.request.delete(`/api/items/${itemId}`, { headers: { origin: new URL(page.url()).origin } });
  expect(res.status(), await res.text()).toBe(204);
});

test("capturing the same link twice reports a duplicate", async ({ page }) => {
  const url = `https://example.org/aop-e2e/${Date.now()}-${Math.random().toString(36).slice(2, 8)}?utm_source=test`;
  await openHome(page);
  const origin = new URL(page.url()).origin;
  const first = await page.request.post("/api/capture", { data: { input: url }, headers: { origin } });
  expect(first.status()).toBe(201);
  const second = await page.request.post("/api/capture", { data: { input: url.replace("?utm_source=test", "") }, headers: { origin } });
  expect(second.status()).toBe(200);
  const body = await second.json();
  expect(body.duplicate).toBe(true);
  await page.request.delete(`/api/items/${body.item.id}`, { headers: { origin } });
});

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("visitors are sent to sign in, and the API refuses them", async ({ page }) => {
  await page.goto("/inbox");
  await expect(page).toHaveURL(/\/login\?next=%2Finbox/);
  const res = await page.request.get("/api/items");
  expect(res.status()).toBe(401);
});
});
