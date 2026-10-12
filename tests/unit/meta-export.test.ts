import { zipSync, strToU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { extractLinksFromFile, extractLinksFromJson, ImportFileError } from "@/lib/import/meta-export";

// Shape modelled on Meta's messages export, but the parser must not depend on it.
const thread = {
  participants: [{ name: "me" }],
  messages: [
    { sender_name: "me", timestamp_ms: 1_700_000_000_000, share: { link: "https://www.instagram.com/reel/AAA/?igsh=1" }, content: "private words" },
    { sender_name: "me", timestamp_ms: 1_700_000_100_000, content: "see https://example.com/article, nice" },
    { deeply: { nested: [{ x: { timestamp: 1_600_000_000, y: "https:\/\/www.instagram.com\/p\/BBB\/" } }] } },
  ],
};

describe("extractLinksFromJson", () => {
  it("finds urls at any depth and carries the closest timestamp", () => {
    const links = [...extractLinksFromJson(thread).values()];
    const byUrl = Object.fromEntries(links.map((l) => [l.url, l.timestamp]));
    expect(byUrl["https://www.instagram.com/reel/AAA/?igsh=1"]).toBe(1_700_000_000_000);
    expect(byUrl["https://example.com/article"]).toBe(1_700_000_100_000);
    expect(byUrl["https://www.instagram.com/p/BBB/"]).toBe(1_600_000_000_000);
    expect(links).toHaveLength(3);
  });

  it("never returns message text", () => {
    const serialized = JSON.stringify([...extractLinksFromJson(thread).values()]);
    expect(serialized).not.toContain("private words");
  });
});

describe("extractLinksFromFile", () => {
  it("reads json and html entries inside a zip and ignores media", async () => {
    const zip = zipSync({
      "your_instagram_activity/messages/inbox/a_1/message_1.json": strToU8(JSON.stringify(thread)),
      "your_instagram_activity/messages/inbox/b_2/message_1.html": strToU8('<a href="https://www.instagram.com/reel/CCC/">x</a>'),
      "media/photo.jpg": new Uint8Array([1, 2, 3]),
    });
    const file = new File([zip], "instagram-export.zip");
    const urls = (await extractLinksFromFile(file)).map((l) => l.url).sort();
    expect(urls).toContain("https://www.instagram.com/reel/CCC/");
    expect(urls).toHaveLength(4);
  });

  it("rejects unsupported files with a friendly error", async () => {
    await expect(extractLinksFromFile(new File(["x"], "a.png"))).rejects.toBeInstanceOf(ImportFileError);
    await expect(extractLinksFromFile(new File(["not a zip"], "a.zip"))).rejects.toBeInstanceOf(ImportFileError);
  });
});
