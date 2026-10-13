import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { captureTokens } from "@/db/schema";
import { consumeCaptureToken, createCaptureToken, listCaptureTokens, revokeCaptureToken } from "@/lib/capture-tokens";
import { db } from "@/lib/db";
import { captureFieldsSchema } from "@/lib/items/types";
import { resetDatabase } from "./helpers";

let userId: string;
beforeEach(async () => {
  userId = await resetDatabase();
});

describe("capture tokens", () => {
  it("are shown once and stored only as a hash", async () => {
    const { token, view } = await createCaptureToken(userId, "iPhone");
    expect(token).toMatch(/^aopc_[A-Za-z0-9_-]{40,}$/);
    const [row] = await db.select().from(captureTokens).where(eq(captureTokens.id, view.id));
    expect(row.tokenHash).not.toContain(token.slice(5));
    expect(JSON.stringify(await listCaptureTokens(userId))).not.toContain(token);
  });

  it("authenticate their owner, count uses, and stop working once revoked", async () => {
    const { token, view } = await createCaptureToken(userId, "iPhone");
    await expect(consumeCaptureToken(token)).resolves.toMatchObject({ userId });
    expect((await listCaptureTokens(userId))[0]).toMatchObject({ useCount: 1 });
    await revokeCaptureToken(userId, view.id);
    await expect(consumeCaptureToken(token)).rejects.toThrow(/revoked/);
  });

  it("rejects unknown tokens and can't be revoked by someone else", async () => {
    await expect(consumeCaptureToken("aopc_nope")).rejects.toThrow();
    const { view } = await createCaptureToken(userId, "iPhone");
    expect(await revokeCaptureToken("someone-else", view.id)).toBe(false);
  });

  it("limits a token to 300 saves per hour, atomically", async () => {
    const { token, view } = await createCaptureToken(userId, "iPhone");
    await db.update(captureTokens).set({ windowCount: 298 }).where(eq(captureTokens.id, view.id));
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => consumeCaptureToken(token)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
  });
});

describe("share-sheet input normalization", () => {
  it("accepts input, url, or text and keeps a caption as the note", () => {
    expect(captureFieldsSchema.parse({ input: "https://www.instagram.com/reel/A/" })).toMatchObject({ input: "https://www.instagram.com/reel/A/" });
    expect(captureFieldsSchema.parse({ url: "https://instagram.com/reel/B/", text: "great trick for agents" })).toMatchObject({
      input: "https://instagram.com/reel/B/",
      note: "great trick for agents",
    });
    expect(captureFieldsSchema.parse({ text: "Check https://instagram.com/reel/C/" })).toMatchObject({ input: "Check https://instagram.com/reel/C/" });
    expect(captureFieldsSchema.safeParse({}).success).toBe(false);
    expect(captureFieldsSchema.safeParse({ input: "   " }).success).toBe(false);
  });
});
