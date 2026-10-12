import { existsSync } from "node:fs";
import path from "node:path";
import { desc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { AgentEvent } from "@aop-inbox/core";
import { devices, executionJobs, items, setupSpecs } from "@/db/schema";
import { db } from "@/lib/db";
import { createPairingCode, pairDevice } from "@/lib/execution/devices";
import { handleAgentEvent, messagesForDevice } from "@/lib/execution/gateway";
import { approveJob, createExecutionJob, requestUndo } from "@/lib/execution/jobs";
import { drainQueue } from "@/lib/ingestion/pipeline";
import { captureItem } from "@/lib/items/capture";
import { sandbox } from "../../packages/agent/test/helpers";
import { resetDatabase } from "./helpers";

let userId: string;
beforeEach(async () => {
  userId = await resetDatabase();
});

/**
 * Full safe path with the real server modules and the real agent runner wired
 * in-process (the HTTP/SSE transport is the only part replaced):
 * capture → detect executable → SetupSpec → pair → dry run → approve → execute
 * → verify → complete → applied → undo.
 */
describe("end-to-end execution (safe fixture in a temp workspace)", () => {
  it("runs, verifies and undoes a setup", async () => {
    const box = sandbox();
    const { itemId } = await captureItem(userId, {
      input: "Scaffold a demo project:\n$ mkdir -p demo-project\n$ touch demo-project/README.md",
    });
    await drainQueue(20_000);
    const item = await db.query.items.findFirst({ where: eq(items.id, itemId) });
    expect(item?.contentIntent).toBe("executable");
    const [spec] = await db.select().from(setupSpecs).where(eq(setupSpecs.itemId, itemId)).orderBy(desc(setupSpecs.revision));
    expect(spec.spec.steps.length).toBe(2);

    const { code } = await createPairingCode(userId);
    const { deviceId } = await pairDevice({ code, name: "Test Mac", platform: "darwin", arch: "arm64", agentVersion: "0.1.0" });
    const device = async () => (await db.select().from(devices).where(eq(devices.id, deviceId)))[0];

    // Transport: server → agent messages, agent → server events.
    const sent: AgentEvent[] = [];
    const pump = async () => {
      for (const message of await messagesForDevice(await device())) await box.runner.handle(message);
      while (box.events.length) {
        const event = box.events.shift()!;
        sent.push(event);
        await handleAgentEvent(await device(), event);
      }
    };
    const status = async (jobId: string) => (await db.select().from(executionJobs).where(eq(executionJobs.id, jobId)))[0];

    const job = await createExecutionJob(userId, itemId);
    await pump();
    expect((await status(job.id)).status).toBe("awaiting_approval");
    expect((await status(job.id)).plan?.length).toBeGreaterThan(0);
    expect(existsSync(path.join(box.paths.workspace, "demo-project"))).toBe(false); // dry run only

    await approveJob(userId, job.id);
    await pump();
    const done = await status(job.id);
    expect(done.status).toBe("done");
    expect(existsSync(path.join(box.paths.workspace, "demo-project/README.md"))).toBe(true);
    expect(sent.some((e) => e.type === "job.step" && e.result.verify?.ok)).toBe(true);
    expect((await db.query.items.findFirst({ where: eq(items.id, itemId) }))?.actionState).toBe("applied");

    await requestUndo(userId, job.id);
    await pump();
    expect((await status(job.id)).status).toBe("rolled_back");
    expect(existsSync(path.join(box.paths.workspace, "demo-project"))).toBe(false);
  });
});
