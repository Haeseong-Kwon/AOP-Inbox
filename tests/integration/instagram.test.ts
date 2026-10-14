import { createHmac } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { instagramLinks, items, user } from "@/db/schema";
import { db } from "@/lib/db";
import { confirmLink, createLinkCode, linkStatus, rejectPendingLink, unlink, validSignature, type InstagramConfig } from "@/lib/instagram";
import { handleMessage, messagesFor, sharedMedia, type InboundMessage } from "@/lib/instagram/inbound";
import { resetDatabase } from "./helpers";

const config: InstagramConfig = { appSecret: "s3cret", verifyToken: "v", accessToken: "tok", accountId: "BOT", botUsername: "shulker_bot" };
const SENDER = "IGSID-1";

let userId: string;
let replies: string[];
let mid = 0;

beforeEach(async () => {
  userId = await resetDatabase();
  replies = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      // GET /{igsid}?fields=username — the profile lookup when a code arrives
      if (!init?.body) return Response.json({ username: url.includes("INTRUDER") ? "stranger.account" : "me_on_ig" });
      replies.push(JSON.parse(String(init.body)).message.text);
      return new Response("{}");
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const dm = (message: Partial<NonNullable<InboundMessage["message"]>>, sender = SENDER): InboundMessage => ({
  sender: { id: sender },
  recipient: { id: "BOT" },
  message: { mid: `m${++mid}`, ...message },
});
const reel = (id: string, title = "Claude Code MCP 5개 세팅법\n댓글에 MCP 남기면 가이드 보내드려요") => ({
  type: "ig_reel",
  payload: { reel_video_id: id, title, url: `https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=${id}&signature=x` },
});
const userItems = () => db.select().from(items).where(eq(items.userId, userId));

/** Approve exactly what Settings shows, as the UI does. */
async function approve(id: string) {
  return confirmLink(id, (await linkStatus(id)).pending!.requestedAt);
}

async function link() {
  const { code } = await createLinkCode(userId);
  await handleMessage(config, dm({ text: `연결 ${code.toLowerCase()}` }));
  await approve(userId);
}

describe("instagram webhook parsing", () => {
  it("checks Meta's sha256 signature over the raw body", () => {
    const body = '{"object":"instagram"}';
    const sig = `sha256=${createHmac("sha256", "s3cret").update(body).digest("hex")}`;
    expect(validSignature(body, sig, "s3cret")).toBe(true);
    expect(validSignature(body + " ", sig, "s3cret")).toBe(false);
    expect(validSignature(body, sig, "other")).toBe(false);
    expect(validSignature(body, null, "s3cret")).toBe(false);
  });

  it("keeps only real messages addressed to our bot", () => {
    const entry = (messaging: unknown[]) => ({ object: "instagram", entry: [{ id: "BOT", messaging }] });
    const ok = { sender: { id: "a" }, recipient: { id: "BOT" }, message: { mid: "1", text: "hi" } };
    expect(messagesFor(entry([ok]), "BOT")).toHaveLength(1);
    expect(messagesFor(entry([{ ...ok, message: { mid: "2", is_echo: true } }]), "BOT")).toHaveLength(0);
    expect(messagesFor(entry([{ ...ok, recipient: { id: "SOMEONE" } }]), "BOT")).toHaveLength(0);
    expect(messagesFor(entry([{ sender: { id: "a" }, recipient: { id: "BOT" }, read: { mid: "1" } }]), "BOT")).toHaveLength(0);
    expect(messagesFor({ object: "page", entry: [{ id: "x", messaging: [ok] }] }, "BOT")).toHaveLength(0);
  });

  it("reads reels and posts, collapsing Meta's duplicate share + ig_post pair", () => {
    const post = { ig_post_media_id: "777", title: "caption", url: "https://lookaside.fbsbx.com/x" };
    expect(sharedMedia({ mid: "1", attachments: [reel("42"), { type: "share", payload: post }, { type: "ig_post", payload: post }, { type: "image", payload: { url: "u" } }] })).toEqual([
      { mediaId: "42", kind: "reel", caption: expect.stringContaining("MCP") },
      { mediaId: "777", kind: "post", caption: "caption" },
    ]);
  });
});

describe("instagram DM capture", () => {
  it("stores nothing from an unlinked sender and tells them how to link", async () => {
    await handleMessage(config, dm({ attachments: [reel("1")], text: "https://example.com" }));
    expect(await userItems()).toHaveLength(0);
    expect(replies[0]).toMatch(/연결 코드/);
  });

  it("a DM'd code only creates a pending request until the user approves the account shown", async () => {
    const { code } = await createLinkCode(userId);
    await handleMessage(config, dm({ text: code }));
    expect(replies.at(-1)).toMatch(/승인/);
    expect(await linkStatus(userId)).toMatchObject({ linked: false, pending: { username: "me_on_ig" } });
    // Approving a request other than the one shown (changed or replaced since) does nothing.
    await expect(confirmLink(userId, new Date(0).toISOString())).rejects.toThrow(/expired/);
    expect((await linkStatus(userId)).linked).toBe(false);
    await handleMessage(config, dm({ attachments: [reel("before-approval")] }));
    expect(await userItems()).toHaveLength(0);

    await approve(userId);
    expect(await linkStatus(userId)).toMatchObject({ linked: true, username: "me_on_ig", pending: null });
  });

  it("someone who grabs your code gets a visible request you can decline — nothing of theirs is saved", async () => {
    const { code } = await createLinkCode(userId);
    await handleMessage(config, dm({ text: code }, "INTRUDER"));
    expect((await linkStatus(userId)).pending).toMatchObject({ username: "stranger.account" });
    // The code was used up by the intruder; the owner's own attempt doesn't override silently.
    await handleMessage(config, dm({ text: code }));
    expect(replies.at(-1)).toMatch(/코드가 맞지 않아요/);
    await rejectPendingLink(userId);
    await handleMessage(config, dm({ attachments: [reel("spam")] }, "INTRUDER"));
    expect(await userItems()).toHaveLength(0);
    expect(await linkStatus(userId)).toMatchObject({ linked: false, pending: null });
  });

  it("an Instagram account can't be linked to two AOP Inbox users", async () => {
    await link();
    await db.insert(user).values({ id: "other", name: "Other", email: "other@aop.local" });
    const { code } = await createLinkCode("other");
    // SENDER is already linked to test-user, so the message is treated as theirs, not as a code.
    await handleMessage(config, dm({ text: code }));
    expect((await linkStatus("other")).pending).toBeNull();
    await expect(confirmLink("other", new Date().toISOString())).rejects.toThrow(/expired/);
    // Even if a pending request for an already-linked account existed, approval refuses it — atomically.
    const at = new Date();
    await db.update(instagramLinks).set({ pendingIgsid: SENDER, pendingAt: at }).where(eq(instagramLinks.userId, "other"));
    await expect(confirmLink("other", at.toISOString())).rejects.toThrow(/already linked/);
    expect((await linkStatus("other")).linked).toBe(false);
  });

  it("links with a one-time code, then saves shared reels by caption without fetching media", async () => {
    await link();
    expect(await linkStatus(userId)).toMatchObject({ linked: true, configured: false });

    await handleMessage(config, dm({ attachments: [reel("4242")] }));
    const [item] = await userItems();
    expect(item).toMatchObject({ sourceType: "instagram", externalId: "4242", contentKind: "reel", originalTitle: "Claude Code MCP 5개 세팅법", sourceUrl: null });
    expect(item.contentText).toContain("가이드");
    expect(replies.at(-1)).toBe("셜커박스에 담았어요 ✓");
    // Only Graph API calls (replies, profile lookup) — never the CDN asset.
    expect(vi.mocked(fetch).mock.calls.every(([url]) => String(url).startsWith("https://graph.instagram.com/"))).toBe(true);

    await handleMessage(config, dm({ attachments: [reel("4242")] }));
    expect(await userItems()).toHaveLength(1);
    expect(replies.at(-1)).toBe("이미 셜커박스에 있어요.");
  });

  it("saves links and notes from text, and ignores a redelivered message", async () => {
    await link();
    const msg = dm({ text: "온보딩에 써먹자 https://www.instagram.com/reel/ABC123/" });
    await handleMessage(config, msg);
    await handleMessage(config, msg); // Meta redelivery, same mid
    const saved = await userItems();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ sourceType: "instagram", userNote: "온보딩에 써먹자" });
  });

  it("codes work once and expire", async () => {
    const { code } = await createLinkCode(userId);
    await db.update(instagramLinks).set({ codeExpiresAt: new Date(Date.now() - 1000) }).where(eq(instagramLinks.userId, userId));
    await handleMessage(config, dm({ text: code }));
    expect(await linkStatus(userId)).toMatchObject({ linked: false, pending: null });

    const fresh = await createLinkCode(userId);
    await handleMessage(config, dm({ text: fresh.code }));
    await handleMessage(config, dm({ text: fresh.code }, "INTRUDER"));
    expect((await linkStatus(userId)).pending).toMatchObject({ username: "me_on_ig" });
  });

  it("stops saving after disconnect", async () => {
    await link();
    await unlink(userId);
    await handleMessage(config, dm({ attachments: [reel("9")] }));
    expect(await db.select().from(items).where(and(eq(items.userId, userId), eq(items.externalId, "9")))).toHaveLength(0);
  });
});

describe("webhook route", () => {
  const env = { INSTAGRAM_APP_SECRET: "s3cret", INSTAGRAM_VERIFY_TOKEN: "verify-me", INSTAGRAM_ACCESS_TOKEN: "t", INSTAGRAM_ACCOUNT_ID: "BOT", INSTAGRAM_BOT_USERNAME: "@shulker_bot" };
  beforeEach(() => Object.entries(env).forEach(([k, v]) => vi.stubEnv(k, v)));
  afterEach(() => vi.unstubAllEnvs());

  it("answers Meta's subscription check only with the right verify token", async () => {
    const { GET } = await import("@/app/api/instagram/webhook/route");
    const url = (token: string) => `https://x/api/instagram/webhook?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=1158201444`;
    expect(await (await GET(new Request(url("verify-me")))).text()).toBe("1158201444");
    expect((await GET(new Request(url("nope")))).status).toBe(403);
  });

  it("rejects unsigned or tampered deliveries before reading them", async () => {
    const { POST } = await import("@/app/api/instagram/webhook/route");
    const body = JSON.stringify({ object: "instagram", entry: [] });
    const post = (sig?: string) => POST(new Request("https://x/api/instagram/webhook", { method: "POST", body, headers: sig ? { "x-hub-signature-256": sig } : {} }));
    expect((await post()).status).toBe(401);
    expect((await post(`sha256=${"0".repeat(64)}`)).status).toBe(401);
  });

  it("is off when the server isn't configured", async () => {
    vi.stubEnv("INSTAGRAM_ACCESS_TOKEN", "");
    const { POST } = await import("@/app/api/instagram/webhook/route");
    expect((await POST(new Request("https://x/api/instagram/webhook", { method: "POST", body: "{}" }))).status).toBe(404);
  });
});
