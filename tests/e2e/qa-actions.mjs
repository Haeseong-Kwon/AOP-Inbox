// Visual QA of the action flow (not part of the suite): node tests/e2e/qa-actions.mjs <outDir> <itemId>
import { chromium } from "@playwright/test";
const [out, itemId] = process.argv.slice(2);
const base = "http://localhost:3000";
const browser = await chromium.launch();
const errors = [];
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark", storageState: "tests/e2e/.auth/user.json" })).newPage();
page.on("pageerror", (e) => errors.push(e.message));
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const waitText = (t, ms = 30000) => page.getByText(t, { exact: false }).first().waitFor({ timeout: ms });

await page.goto(`${base}/inbox?item=${itemId}`); await page.waitForTimeout(1500); await shot("a1-detail-actions");
await page.goto(`${base}/items/${itemId}/setup`); await waitText("Run with AOP Inbox"); await page.waitForTimeout(800); await shot("a2-setup-review");
await page.getByRole("button", { name: "Run with AOP Inbox" }).click();
await waitText("Ready for your approval"); await page.waitForTimeout(500); await shot("a3-awaiting-approval");
await page.getByRole("button", { name: "Review & approve" }).click(); await page.waitForTimeout(500); await shot("a4-approve-dialog");
await page.getByRole("button", { name: "Approve once" }).click();
await waitText("This step needs you", 45000); await page.waitForTimeout(500); await shot("a5a-needs-you");
await page.getByRole("button", { name: /I’ve done it/ }).click();
await waitText("Applied and verified", 45000); await page.waitForTimeout(800); await shot("a5-applied");
await page.getByRole("button", { name: "Undo" }).first().click();
await waitText("Undone", 45000); await page.waitForTimeout(500); await shot("a6-undone");
await page.goto(`${base}/activity`); await page.waitForTimeout(1200); await shot("a7-activity");
await page.goto(`${base}/settings#agent`); await page.waitForTimeout(1200); await page.locator("#agent").scrollIntoViewIfNeeded(); await shot("a8-settings-agent");
await page.goto(`${base}/`); await page.waitForTimeout(1500); await shot("a9-home");
await page.goto(`${base}/inbox`); await page.waitForTimeout(1500); await shot("a10-inbox");

const m = await (await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "dark", storageState: "tests/e2e/.auth/user.json" })).newPage();
m.on("pageerror", (e) => errors.push("390 " + e.message));
await m.goto(`${base}/items/${itemId}/setup`); await m.waitForTimeout(1500); await m.screenshot({ path: `${out}/m1-setup.png` });
await m.goto(`${base}/activity`); await m.waitForTimeout(1200); await m.screenshot({ path: `${out}/m2-activity.png` });
const overflow = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
if (overflow) errors.push("390 setup overflow");
await browser.close();
console.log(errors.length ? errors.join("\n") : "no errors");
