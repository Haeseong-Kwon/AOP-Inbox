import { AgentEventSchema, HEARTBEAT_MS, ServerMessageSchema, type AgentEvent, type ServerMessage } from "@aop-inbox/core";
import type { Ledger } from "./ledger";

/**
 * Outbound-only connection to the AOP Inbox gateway: an SSE stream down and
 * HTTPS POSTs up. Events go through the ledger's outbox first, so nothing is
 * lost while offline; they're delivered in order when the connection returns.
 */

export function assertSafeServer(server: string): URL {
  const url = new URL(server);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) throw new Error("The server must use https:// (http:// is only allowed for localhost)");
  return url;
}

export class GatewayClient {
  private stopped = false;
  private flushing = false;
  private heartbeat?: NodeJS.Timeout;
  connected = false;

  constructor(
    private server: string,
    private token: string,
    private ledger: Ledger,
    private onMessage: (m: ServerMessage) => Promise<void>,
    private status: () => { paused: boolean; activeJobId: string | null },
    private hello: () => AgentEvent,
  ) {
    assertSafeServer(server);
  }

  private headers(extra: Record<string, string> = {}) {
    return { authorization: `Bearer ${this.token}`, "user-agent": "aop-inbox-agent", ...extra };
  }

  /** Record locally, then try to deliver. */
  async emit(event: AgentEvent): Promise<void> {
    this.ledger.enqueueEvent(AgentEventSchema.parse(event));
    await this.flush();
  }

  async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      for (const { id, payload } of this.ledger.pendingEvents()) {
        let res: Response;
        try {
          res = await fetch(new URL("/api/agent/events", this.server), { method: "POST", headers: this.headers({ "content-type": "application/json" }), body: payload, signal: AbortSignal.timeout(15_000) });
        } catch {
          return; // offline — retry on reconnect
        }
        if (res.status === 401) throw new Error("This Mac's token was revoked. Run `aop-inbox init` to pair again.");
        if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 429)) this.ledger.markSent(id); // 4xx won't succeed on retry
        else return;
      }
    } finally {
      this.flushing = false;
    }
  }

  async run(): Promise<void> {
    let backoff = 1000;
    this.heartbeat = setInterval(() => {
      if (this.connected) void this.emit({ type: "agent.heartbeat", ...this.status() }).catch(() => {});
    }, HEARTBEAT_MS);
    while (!this.stopped) {
      try {
        const res = await fetch(new URL("/api/agent/stream", this.server), { headers: this.headers({ accept: "text/event-stream" }) });
        if (res.status === 401) throw new Error("This Mac's token was revoked or is invalid. Run `aop-inbox init` to pair again.");
        if (!res.ok || !res.body) throw new Error(`Gateway answered ${res.status}`);
        this.connected = true;
        backoff = 1000;
        await this.emit(this.hello());
        await this.read(res.body);
      } catch (error) {
        if ((error as Error).message.includes("revoked")) {
          this.stop();
          throw error;
        }
      }
      this.connected = false;
      if (!this.stopped) await new Promise((r) => setTimeout(r, backoff));
      backoff = Math.min(backoff * 2, 30_000);
    }
  }

  private async read(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (!this.stopped) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const data = chunk
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trim())
          .join("");
        if (!data) continue;
        let parsed;
        try {
          parsed = ServerMessageSchema.safeParse(JSON.parse(data));
        } catch {
          continue;
        }
        if (parsed.success) await this.onMessage(parsed.data);
      }
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
  }
}
