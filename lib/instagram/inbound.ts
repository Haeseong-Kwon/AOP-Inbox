import "server-only";
import { z } from "zod";
import { captureInstagramShare, captureItem, type CaptureResult } from "@/lib/items/capture";
import { translate } from "@/lib/i18n";
import { errorMessage, log } from "@/lib/log";
import { firstDelivery, LINK_CODE_PATTERN, noteMessage, redeemLinkCode, reply, userForSender, type InstagramConfig } from "./index";

/* Lenient schema: Meta adds fields over time; we only read what we need. */
const attachmentSchema = z.object({
  type: z.string(),
  payload: z
    .object({
      url: z.string().optional(),
      title: z.string().nullish(),
      reel_video_id: z.union([z.string(), z.number()]).optional(),
      ig_post_media_id: z.union([z.string(), z.number()]).optional(),
      video_id: z.union([z.string(), z.number()]).optional(),
    })
    .passthrough()
    .optional(),
});

const messagingSchema = z.object({
  sender: z.object({ id: z.string() }),
  recipient: z.object({ id: z.string() }),
  message: z
    .object({
      mid: z.string(),
      text: z.string().optional(),
      attachments: z.array(attachmentSchema).optional(),
      is_echo: z.boolean().optional(),
      is_deleted: z.boolean().optional(),
      is_unsupported: z.boolean().optional(),
    })
    .optional(),
});

export const webhookSchema = z.object({
  object: z.string(),
  entry: z.array(z.object({ id: z.string(), messaging: z.array(z.unknown()).optional() })),
});

export type InboundMessage = z.infer<typeof messagingSchema>;

/** Valid message events addressed to our bot. Everything else (echoes, reactions, reads) is dropped. */
export function messagesFor(body: z.infer<typeof webhookSchema>, accountId: string): InboundMessage[] {
  if (body.object !== "instagram") return [];
  return body.entry.flatMap((e) =>
    (e.messaging ?? []).flatMap((raw) => {
      const parsed = messagingSchema.safeParse(raw);
      if (!parsed.success) return [];
      const m = parsed.data;
      const message = m.message;
      if (!message || message.is_echo || message.is_deleted || m.recipient.id !== accountId) return [];
      return [m];
    }),
  );
}

export interface SharedMedia {
  mediaId: string;
  kind: "reel" | "post";
  caption: string | null;
}

const SHARE_TYPES: Record<string, SharedMedia["kind"]> = { ig_reel: "reel", reel: "reel", ig_post: "post", share: "post" };

/** Reels and posts shared into the DM. During Meta's transition `share` and `ig_post` arrive together — dedupe by media. */
export function sharedMedia(message: NonNullable<InboundMessage["message"]>): SharedMedia[] {
  const seen = new Map<string, SharedMedia>();
  for (const a of message.attachments ?? []) {
    const kind = SHARE_TYPES[a.type];
    const id = a.payload?.reel_video_id ?? a.payload?.ig_post_media_id ?? a.payload?.video_id;
    if (!kind || id === undefined) continue;
    const mediaId = String(id);
    if (!seen.has(mediaId)) seen.set(mediaId, { mediaId, kind, caption: a.payload?.title ?? null });
  }
  return [...seen.values()];
}

// Bot replies are in Korean (the default language); the bot can't know a sender's UI language.
const ko = (text: string, vars?: Record<string, string | number>) => translate("ko", text, vars);

function savedReply(results: CaptureResult[]): string {
  const fresh = results.filter((r) => !r.duplicate).length;
  if (fresh === 0) return ko("Already in your shulker box.");
  return results.length === 1 ? ko("Stored in your shulker box ✓") : ko("Stored {n} in your shulker box ✓", { n: fresh });
}

/**
 * One DM to the bot. Unlinked senders can only redeem a link code; nothing they
 * send is stored. Linked senders' shares, links and notes go through capture.
 */
export async function handleMessage(config: InstagramConfig, m: InboundMessage): Promise<void> {
  const message = m.message!;
  if (!(await firstDelivery(message.mid))) return;
  const igsid = m.sender.id;
  const text = message.text?.trim() ?? "";

  const userId = await userForSender(igsid);
  if (!userId) {
    const linked = text ? await redeemLinkCode(igsid, text) : null;
    log.info("instagram.unlinked_message", { linked: Boolean(linked) });
    await reply(
      config,
      igsid,
      linked
        ? ko("Linked to AOP Inbox. Share any Reel to this chat and the shulker will keep it.")
        : ko("To save here, get a link code in AOP Inbox → Settings → Instagram DM and send it in this chat."),
    );
    return;
  }

  try {
    const results: CaptureResult[] = [];
    for (const media of sharedMedia(message)) results.push(await captureInstagramShare(userId, media));
    // Text that isn't a (re-sent) link code: a link or a thought to keep.
    if (text && !LINK_CODE_PATTERN.test(text)) results.push(await captureItem(userId, { input: text }));

    await noteMessage(userId);
    if (results.length) await reply(config, igsid, savedReply(results));
    else if (message.attachments?.length || message.is_unsupported)
      await reply(config, igsid, ko("The shulker keeps shared Reels and posts, links, and notes. Photos and voice messages aren't saved."));
  } catch (error) {
    log.error("instagram.capture_failed", { error: errorMessage(error) });
    await reply(config, igsid, ko("Couldn't save that one. Try sharing it again in a moment."));
  }
}
