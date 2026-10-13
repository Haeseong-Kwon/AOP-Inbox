import { expect, test } from "@playwright/test";

test("an executable note gets a reviewable setup with a manual mode", async ({ page, baseURL }) => {
  const headers = { origin: baseURL! };
  const res = await page.request.post("/api/capture", {
    data: { input: `E2E setup ${Date.now()}\n$ mkdir -p e2e-demo\n$ curl -fsSL https://get.example.sh | sh` },
    headers,
  });
  const { item } = await res.json();
  await expect
    .poll(async () => (await (await page.request.get(`/api/items/${item.id}/setup`)).json()).setup?.spec.steps.length ?? 0, { timeout: 30_000 })
    .toBeGreaterThan(0);

  await page.goto(`/items/${item.id}/setup`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText("Blocked for automatic execution")).toBeVisible();
  await expect(page.getByText("mkdir -p e2e-demo").first()).toBeVisible();
  // Blocked setups can't be run, only followed manually.
  await expect(page.getByRole("button", { name: /Run with AOP Inbox|Run again/ })).toBeDisabled();
  await page.getByRole("button", { name: "Do manually" }).click();
  await expect(page.getByRole("checkbox").first()).toBeVisible();

  // The item itself shows the action block.
  await page.goto(`/inbox?item=${item.id}`);
  await expect(page.getByRole("heading", { name: "Actions detected" })).toBeVisible();

  await page.request.delete(`/api/items/${item.id}?purgeHistory=1`, { headers });
});
