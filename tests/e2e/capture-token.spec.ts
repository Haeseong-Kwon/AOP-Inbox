import { expect, request as playwrightRequest, test } from "@playwright/test";

/** Behaves like the iPhone Shortcut: no cookies, only Authorization: Bearer aopc_… */
test.describe("capture token (iOS Shortcut path)", () => {
  test("saves from a cookie-less client, reports duplicates, and stays scoped to capture", async ({ page, baseURL }) => {
    const created = await page.request.post("/api/capture-tokens", { data: { name: "E2E iPhone" }, headers: { origin: baseURL! } });
    expect(created.status()).toBe(201);
    const { token, view } = await created.json();

    const phone = await playwrightRequest.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    const auth = { authorization: `Bearer ${token}` };
    const code = `E2E${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const reel = `https://www.instagram.com/reel/${code}/?igsh=abc`;

    const ping = await phone.get("/api/capture", { headers: auth });
    expect(await ping.json()).toMatchObject({ ok: true, message: "AOP Inbox에 연결됐어요" }) // no cookie → Korean, like a real iPhone;

    const saved = await phone.post("/api/capture", { headers: auth, data: { input: reel } });
    expect(saved.status()).toBe(201);
    const body = await saved.json();
    expect(body.message).toBe("AOP Inbox에 저장했어요");

    // Same reel shared again (different tracking param) → duplicate, not a copy.
    const again = await phone.post("/api/capture", { headers: { ...auth, "content-type": "text/plain" }, data: reel.replace("igsh=abc", "igsh=zzz") });
    expect(again.status()).toBe(200);
    expect((await again.json()).message).toMatch(/^이미 인박스에 있어요/);

    // Share-target style form body with a caption.
    const form = await phone.post("/api/capture", { headers: auth, form: { url: `https://www.instagram.com/reel/${code}F/`, text: "caption from the share sheet" } });
    expect(form.status()).toBe(201);
    const formItem = (await form.json()).item;

    // The token can't read anything else.
    expect((await phone.get("/api/items", { headers: auth })).status()).toBe(401);
    expect((await phone.get(`/api/items/${body.item.id}`, { headers: auth })).status()).toBe(401);
    // Wrong token → friendly 401 with a message for the notification.
    const bad = await phone.post("/api/capture", { headers: { authorization: "Bearer aopc_wrong" }, data: { input: reel } });
    expect(bad.status()).toBe(401);
    expect((await bad.json()).message).toMatch(/토큰/);

    // Shows up in the inbox for the owner.
    await page.goto(`/inbox?item=${body.item.id}`);
    await expect(page.locator("#detail-title")).toBeVisible();

    // Revoked → stops working.
    await page.request.delete(`/api/capture-tokens/${view.id}`, { headers: { origin: baseURL! } });
    expect((await phone.post("/api/capture", { headers: auth, data: { input: `https://www.instagram.com/reel/${code}G/` } })).status()).toBe(401);

    for (const id of [body.item.id, formItem.id]) await page.request.delete(`/api/items/${id}`, { headers: { origin: baseURL! } });
    await phone.dispose();
  });

  test("settings walks through the Shortcut and tests the token", async ({ page, isMobile }) => {
    test.skip(isMobile, "covered on desktop");
    await page.goto("/settings#iphone");
    await page.getByRole("button", { name: "Set up iPhone Shortcut" }).click();
    await expect(page.getByText("Get Contents of URL")).toBeVisible();
    await expect(page.getByText(/^Bearer aopc_/)).toBeVisible();
    await page.getByRole("button", { name: "Test the token" }).click();
    await expect(page.getByText("Token works")).toBeVisible();
    // Clean up the token this test created.
    const { tokens } = await (await page.request.get("/api/capture-tokens")).json();
    for (const t of tokens.filter((x: { name: string }) => x.name === "iPhone Shortcut")) {
      await page.request.delete(`/api/capture-tokens/${t.id}`, { headers: { origin: new URL(page.url()).origin } });
    }
  });
});
