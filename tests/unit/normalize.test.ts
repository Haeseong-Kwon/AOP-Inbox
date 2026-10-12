import { describe, expect, it } from "vitest";
import { extractFirstUrl, normalizeUrl, parseUrl } from "@/lib/sources/normalize";

describe("parseUrl", () => {
  it("accepts bare domains and rejects non-urls", () => {
    expect(parseUrl("example.com/a")?.toString()).toBe("https://example.com/a");
    expect(parseUrl("just a note")).toBeNull();
    expect(parseUrl("javascript:alert(1)")).toBeNull();
    expect(parseUrl("ftp://example.com")).toBeNull();
  });
});

describe("instagram normalization", () => {
  it("treats share-link variants of the same reel as one canonical url", () => {
    const a = normalizeUrl("https://www.instagram.com/reel/ABC123/?igsh=xyz&utm_source=ig_web_copy_link");
    const b = normalizeUrl("https://instagram.com/reel/ABC123");
    const c = normalizeUrl("instagram.com/reels/ABC123/");
    const d = normalizeUrl("https://www.instagram.com/someuser/reel/ABC123/");
    expect(a?.canonicalUrl).toBe("https://www.instagram.com/reel/ABC123/");
    expect([b, c, d].map((n) => n?.canonicalUrl)).toEqual(Array(3).fill(a?.canonicalUrl));
    expect(a).toMatchObject({ sourceType: "instagram", externalId: "ABC123", contentKind: "reel" });
    expect(a?.sourceUrl).not.toContain("igsh");
  });

  it("detects posts and tv", () => {
    expect(normalizeUrl("https://www.instagram.com/p/XyZ_-9/")).toMatchObject({ contentKind: "post", canonicalUrl: "https://www.instagram.com/p/XyZ_-9/" });
    expect(normalizeUrl("https://instagram.com/tv/Q1/")?.contentKind).toBe("tv");
  });
});

describe("youtube normalization", () => {
  it("unifies youtu.be and watch urls but keeps the video id", () => {
    const a = normalizeUrl("https://youtu.be/dQw4w9WgXcQ?si=abc");
    const b = normalizeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&feature=share");
    expect(a?.canonicalUrl).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(b?.canonicalUrl).toBe(a?.canonicalUrl);
    expect(normalizeUrl("https://youtube.com/shorts/abc")?.contentKind).toBe("short");
  });
});

describe("generic web normalization", () => {
  it("strips tracking params but keeps meaningful ones", () => {
    const n = normalizeUrl("https://www.Example.com/post/?id=7&utm_campaign=x&fbclid=1#section");
    expect(n?.canonicalUrl).toBe("https://example.com/post?id=7");
    expect(n?.sourceType).toBe("web");
  });

  it("labels known hosts", () => {
    expect(normalizeUrl("https://twitter.com/a/status/1")?.canonicalUrl).toBe("https://x.com/a/status/1");
    expect(normalizeUrl("https://github.com/vercel/next.js")?.sourceType).toBe("github");
    expect(normalizeUrl("https://arxiv.org/pdf/2401.00001.pdf")?.sourceType).toBe("pdf");
  });
});

describe("extractFirstUrl", () => {
  it("finds a url inside shared text", () => {
    expect(extractFirstUrl("Look at this! https://instagram.com/reel/A1/?igsh=2).")).toBe("https://instagram.com/reel/A1/?igsh=2");
    expect(extractFirstUrl("no link")).toBeNull();
  });
});
