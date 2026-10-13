// Visual QA: failing setup with automatic rollback, Ask with setup citations (not part of the suite).
import { chromium } from "@playwright/test";
const [out] = process.argv.slice(2);
const base = "http://localhost:3000";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark", storageState: "tests/e2e/.auth/user.json" });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const origin = { origin: base };
const cap = await page.request.post(`${base}/api/capture`, { data: { input: "QA failure demo:\n$ mkdir -p qa-demo\n$ ls qa-missing-folder" }, headers: origin });
const { item } = await cap.json();
for (let i = 0; i < 30; i++) {
  const s = await (await page.request.get(`${base}/api/items/${item.id}/setup`)).json();
  if (s.setup) break;
  await page.waitForTimeout(1000);
}
await page.goto(`${base}/items/${item.id}/setup`);
await page.getByRole("button", { name: "Run with AOP Inbox" }).click();
await page.getByText("Ready for your approval").waitFor({ timeout: 30000 });
await page.getByRole("button", { name: "Review & approve" }).click();
await page.getByRole("button", { name: "Approve once" }).click();
await page.getByText("previous configuration has been restored").waitFor({ timeout: 45000 });
await page.getByRole("button", { name: "View details" }).click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/f1-failed.png` });
await page.goto(`${base}/ask`);
await page.getByLabel("Ask a question about your saved items").fill("What did I set up for Claude Code recently?");
await page.keyboard.press("Enter");
await page.waitForTimeout(3500);
await page.screenshot({ path: `${out}/f2-ask-setups.png`, fullPage: true });
await page.request.delete(`${base}/api/items/${item.id}?purgeHistory=1`, { headers: origin });
await browser.close();
console.log(errors.length ? errors.join("\n") : "no errors");
