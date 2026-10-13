import { describe, expect, it } from "vitest";
import { readBodyText } from "@/lib/body";

function chunked(chunks: string[], headers: Record<string, string> = {}) {
  const enc = new TextEncoder();
  const body = new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
  // No Content-Length: the way a chunked upload arrives.
  return new Request("http://x/api", { method: "POST", body, headers, duplex: "half" } as RequestInit);
}

describe("readBodyText", () => {
  it("enforces the cap on streamed bytes even without Content-Length", async () => {
    await expect(readBodyText(chunked(Array(100).fill("x".repeat(1000))), 64_000)).rejects.toThrow(/too large/);
  });
  it("rejects an oversized declared length up front", async () => {
    await expect(readBodyText(chunked(["hi"], { "content-length": "999999" }), 64_000)).rejects.toThrow(/too large/);
  });
  it("returns small bodies intact, including multi-byte text", async () => {
    expect(await readBodyText(chunked(["저장", "할 링크"]), 64_000)).toBe("저장할 링크");
  });
});
