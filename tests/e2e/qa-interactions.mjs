// Visual QA of overlays and flows (not part of the suite): node tests/e2e/qa-interactions.mjs <outDir>
import { chromium } from "@playwright/test";
const out = process.argv[2];
const base = "http://localhost:3000";
const browser = await chromium.launch();
const errors = [];
async function ctx(width, scheme = "dark") {
  const c = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 }, colorScheme: scheme, storageState: "tests/e2e/.auth/user.json" });
  const p = await c.newPage();
  p.on("pageerror", (e) => errors.push(`${width} ${e.message}`));
  return p;
}
const shot = (p, name) => p.screenshot({ path: `${out}/${name}.png` });

let p = await ctx(1440);
await p.goto(base + "/inbox"); await p.waitForTimeout(800);
await p.keyboard.press("Meta+k"); await p.waitForTimeout(400); await p.keyboard.type("agent"); await p.waitForTimeout(900); await shot(p, "palette");
await p.keyboard.press("Escape"); await p.keyboard.press("c"); await p.waitForTimeout(300);
await p.keyboard.type("https://www.instagram.com/reel/QaDemo123/?igsh=xx"); await p.waitForTimeout(300); await shot(p, "capture");
await p.keyboard.press("Escape");
await p.keyboard.press("j"); await p.keyboard.press("j"); await p.keyboard.press("Enter"); await p.waitForTimeout(900); await shot(p, "jk-open");
await p.goto(base + "/ask"); await p.waitForTimeout(500);
await p.getByLabel("Ask a question about your saved items").fill("What have I saved about coding agents?"); await p.keyboard.press("Enter");
await p.waitForTimeout(2500); await shot(p, "ask-answer");
await p.goto(base + "/onboarding"); await p.waitForTimeout(600); await shot(p, "onboarding");
await p.context().close();

p = await ctx(768);
await p.goto(base + "/inbox"); await p.waitForTimeout(800); await shot(p, "768-inbox");
await p.locator("[data-item-id]").first().click(); await p.waitForTimeout(900); await shot(p, "768-detail");
await p.goto(base + "/"); await p.waitForTimeout(800); await shot(p, "768-home");
await p.context().close();

p = await ctx(390);
await p.goto(base + "/inbox"); await p.waitForTimeout(800);
await p.locator("[data-item-id]").first().click(); await p.waitForTimeout(900); await shot(p, "390-detail");
await p.goto(base + "/search?q=onboarding"); await p.waitForTimeout(1200); await shot(p, "390-search");
await p.goto(base + "/ask"); await p.waitForTimeout(600); await shot(p, "390-ask");
await p.goto(base + "/collections"); await p.waitForTimeout(800); await shot(p, "390-collections");
await p.context().close();

p = await ctx(1440, "light");
await p.evaluate(() => localStorage.setItem("theme", "light")).catch(() => {});
await p.goto(base + "/inbox"); await p.evaluate(() => localStorage.setItem("theme", "light")); await p.reload(); await p.waitForTimeout(800);
await p.locator("[data-item-id]").first().click(); await p.waitForTimeout(900); await shot(p, "light-inbox");
await p.context().close();

const login = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" })).newPage();
await login.goto(base + "/login"); await login.waitForTimeout(500); await shot(login, "login");
await browser.close();
console.log(errors.length ? errors.join("\n") : "no errors");
