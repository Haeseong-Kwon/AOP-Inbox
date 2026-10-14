import { after } from "next/server";
import { readBodyText } from "@/lib/body";
import { instagramConfig, validSignature } from "@/lib/instagram";
import { handleMessage, messagesFor, webhookSchema } from "@/lib/instagram/inbound";
import { errorMessage, log } from "@/lib/log";

const MAX_BODY = 256_000;

/** Meta's subscription check: echo hub.challenge only for our verify token. */
export async function GET(req: Request) {
  const config = instagramConfig();
  const params = new URL(req.url).searchParams;
  if (!config || params.get("hub.mode") !== "subscribe" || params.get("hub.verify_token") !== config.verifyToken) {
    return new Response("Forbidden", { status: 403 });
  }
  return new Response(params.get("hub.challenge") ?? "", { headers: { "content-type": "text/plain" } });
}

/** Signed by Meta with the app secret. Acknowledge fast; capture runs after the response. */
export async function POST(req: Request) {
  const config = instagramConfig();
  if (!config) return new Response("Not configured", { status: 404 });
  const raw = await readBodyText(req, MAX_BODY);
  if (!validSignature(raw, req.headers.get("x-hub-signature-256"), config.appSecret)) {
    log.warn("instagram.bad_signature", {});
    return new Response("Bad signature", { status: 401 });
  }
  let parsed;
  try {
    parsed = webhookSchema.safeParse(JSON.parse(raw));
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  if (!parsed.success) return new Response("OK"); // not a shape we handle; don't make Meta retry
  const messages = messagesFor(parsed.data, config.accountId);
  after(async () => {
    for (const m of messages) {
      try {
        await handleMessage(config, m);
      } catch (error) {
        log.error("instagram.webhook_failed", { error: errorMessage(error) });
      }
    }
  });
  return new Response("OK");
}
