import { HEARTBEAT_MS } from "@aop-inbox/core";
import { withDevice } from "@/lib/execution/agent-http";
import { currentDevice, touchDevice } from "@/lib/execution/devices";
import { messagesForDevice } from "@/lib/execution/gateway";
import { errorMessage, log } from "@/lib/log";

const POLL_MS = 2000;
// Well under typical function limits; the agent reconnects automatically.
const MAX_STREAM_MS = 4 * 60_000;

/**
 * Server → agent channel (SSE). The agent connects out; nothing listens on the Mac.
 * Polls the DB for this device's work and pushes it; comments keep proxies from idling out.
 */
export const GET = withDevice(async (req, device) => {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      const started = Date.now();
      let lastPing = 0;
      let closed = false;
      req.signal.addEventListener("abort", () => (closed = true));
      try {
        await touchDevice(device.id);
        while (!closed && Date.now() - started < MAX_STREAM_MS) {
          // Re-read every tick: revocation, pause and auto-run changes apply immediately.
          const fresh = await currentDevice(device.id);
          if (!fresh) break;
          for (const message of await messagesForDevice(fresh)) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(message)}\n\n`));
          }
          if (Date.now() - lastPing > HEARTBEAT_MS - 5000) {
            controller.enqueue(encoder.encode(`: ping\n\n`));
            await touchDevice(device.id);
            lastPing = Date.now();
          }
          await new Promise((r) => setTimeout(r, POLL_MS));
        }
      } catch (error) {
        log.warn("agent.stream_error", { deviceId: device.id, error: errorMessage(error) });
      }
      try {
        controller.close();
      } catch {
        // already closed by the client
      }
    },
  });
  return new Response(body, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" } });
});
