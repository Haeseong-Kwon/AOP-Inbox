// Visual QA helper (not part of the test suite): node tests/e2e/qa-shots.mjs <outDir> [width,...] [paths...]
import { chromium } from "@playwright/test";
const [outDir, widthsArg = "1440", ...paths] = process.argv.slice(2);
const base = process.env.BASE_URL ?? "http://localhost:3000";
const browser = await chromium.launch();
const errors = [];
for (const width of widthsArg.split(",").map(Number)) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 }, colorScheme: process.env.SCHEME ?? "dark", deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${width} ${page.url()} ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`${width} ${page.url()} console: ${m.text().slice(0, 200)}`));
  await page.goto(`${base}/login`);
  await page.getByRole("button", { name: /^(Sign in|로그인)$/ }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
  for (const p of paths.length ? paths : ["/"]) {
    await page.goto(base + p);
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(600);
    const name = `${width}-${p.replace(/[^a-z0-9]+/gi, "_") || "home"}.png`;
    await page.screenshot({ path: `${outDir}/${name}`, fullPage: false });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    if (overflow) errors.push(`${width} ${p} horizontal overflow`);
  }
  await ctx.close();
}
await browser.close();
console.log(errors.length ? errors.join("\n") : "no errors");
