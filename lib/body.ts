import { HttpError } from "@/lib/errors";

/**
 * Read a request body as text with a hard byte cap enforced while streaming.
 * Content-Length is advisory (chunked requests omit it), so the cap is applied
 * to the bytes actually received and the stream is cancelled once exceeded.
 */
export async function readBodyText(req: Request, maxBytes: number): Promise<string> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new HttpError(413, "That request is too large.");
  if (!req.body) return "";
  const reader = req.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new HttpError(413, "That request is too large.");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}
