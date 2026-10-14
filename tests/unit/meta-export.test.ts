import { zipSync, strToU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { extractLinksFromFile, extractLinksFromJson, fixMetaText, ImportFileError } from "@/lib/import/meta-export";

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

describe("what a full export contributes", () => {
  // Meta escapes UTF-8 bytes one by one: "안녕" arrives as "ì\u0095\u0088ë\u0085\u0095".
  const mangled = (text: string) => String.fromCharCode(...new TextEncoder().encode(text));
  const json = (v: unknown) => strToU8(JSON.stringify(v));
  const fullExport = () =>
    zipSync({
      "your_instagram_activity/saved/saved_posts.json": json({
        saved_saved_media: [{ title: "chef.kim", string_map_data: { "Saved on": { href: "https://www.instagram.com/reel/SAVED/", timestamp: 1_650_000_000 } } }],
      }),
      "your_instagram_activity/messages/inbox/me_1/message_1.json": json({
        participants: [{ name: "me" }],
        messages: [
          { sender_name: "me", timestamp_ms: 1_700_000_000_000, share: { link: "https://www.instagram.com/reel/SELF/", share_text: mangled("파스타 레시피\n재료"), original_content_owner: "cook" } },
        ],
      }),
      "your_instagram_activity/messages/inbox/friend_2/message_1.json": json({
        participants: [{ name: "friend" }, { name: "me" }],
        messages: [
          { sender_name: "friend", timestamp_ms: 1_700_000_000_000, share: { link: "https://www.instagram.com/reel/FRIEND/" } },
          { sender_name: "me", timestamp_ms: 1_600_000_000_000, share: { link: "https://www.instagram.com/reel/SAVED/" } },
        ],
      }),
      "your_instagram_activity/messages/message_requests/x_3/message_1.json": json({
        participants: [{ name: "stranger" }, { name: "me" }],
        messages: [{ share: { link: "https://www.instagram.com/reel/SPAM/" } }],
      }),
      "ads_information/ads_and_topics/posts_viewed.json": json({ impressions: [{ href: "https://www.instagram.com/p/VIEWED/" }] }),
      "ads_information/ads_and_topics/videos_watched.json": json({ impressions: [{ href: "https://www.instagram.com/reel/WATCHED/" }] }),
      "your_instagram_activity/likes/liked_posts.json": json({ likes_media_likes: [{ href: "https://www.instagram.com/p/LIKED/" }] }),
    });

  it("reads only Saved and DM threads, and tags where each link came from", async () => {
    const links = await extractLinksFromFile(new File([fullExport()], "export.zip"));
    const byUrl = Object.fromEntries(links.map((l) => [l.url, l]));
    expect(Object.keys(byUrl).sort()).toEqual(
      ["https://www.instagram.com/reel/FRIEND/", "https://www.instagram.com/reel/SAVED/", "https://www.instagram.com/reel/SELF/"].sort(),
    );
    expect(byUrl["https://www.instagram.com/reel/SELF/"]).toMatchObject({ origin: "self", caption: "파스타 레시피\n재료", author: "cook" });
    expect(byUrl["https://www.instagram.com/reel/FRIEND/"].origin).toBe("dm");
    // Also shared in a chat, earlier: stays "saved" but keeps the earliest date.
    expect(byUrl["https://www.instagram.com/reel/SAVED/"]).toMatchObject({ origin: "saved", author: "chef.kim", timestamp: 1_600_000_000_000 });
  });

  it("reads the 2025+ Saved format, whose labels come in the account's language", async () => {
    // Real shape (values invented): labels are translated, so parsing must not depend on them.
    const saved = [
      {
        timestamp: 1_791_801_878,
        media: [],
        label_values: [
          { label: "URL", value: "https://www.instagram.com/p/NEWFMT/", href: "https://www.instagram.com/p/NEWFMT/" },
          { label: mangled("캡션"), value: mangled("주말 브런치 레시피 🍳 — 재료는 아래에") },
          { label: mangled("제목"), value: "" },
          { dict: [{ dict: [{ label: mangled("이름"), value: "brunch" }], title: "" }], title: mangled("해시태그") },
          {
            dict: [{ dict: [{ label: "URL", value: "https://cook.example" }, { label: mangled("이름"), value: "Cook Kim" }, { label: mangled("사용자 이름"), value: "cook.kim" }], title: "" }],
            title: mangled("소유자"),
          },
        ],
        fbid: "1",
      },
    ];
    const zip = zipSync({ "your_instagram_activity/saved/saved_posts.json": json(saved) });
    const [link] = await extractLinksFromFile(new File([zip], "export.zip"));
    expect(link).toEqual({
      url: "https://www.instagram.com/p/NEWFMT/",
      origin: "saved",
      timestamp: 1_791_801_878_000,
      caption: "주말 브런치 레시피 🍳 — 재료는 아래에",
      author: "cook.kim",
    });
  });

  it("recovers a caption Meta cut mid-character", () => {
    const cut = mangled("셜커박스").slice(0, -1); // last character's final byte missing
    expect(fixMetaText(cut)).toBe("셜커박");
  });

  it("a single history file outside Saved/DMs yields nothing", async () => {
    const viewed = new File([JSON.stringify({ impressions: [{ href: "https://www.instagram.com/p/VIEWED/" }] })], "posts_viewed.json");
    expect(await extractLinksFromFile(viewed)).toEqual([]);
  });

  it("repairs Meta's mangled UTF-8 and leaves normal text alone", () => {
    expect(fixMetaText(mangled("셜커 café"))).toBe("셜커 café");
    expect(fixMetaText("café")).toBe("café");
    expect(fixMetaText("셜커")).toBe("셜커");
  });
});
