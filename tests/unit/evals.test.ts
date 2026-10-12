import { describe, expect, it } from "vitest";
import { runEvals } from "@/evals/run";

describe("action-layer golden set", () => {
  const results = runEvals();
  it("has at least 15 fixtures", () => expect(results.length).toBeGreaterThanOrEqual(15));
  it.each(results.map((r) => [r.id, r] as const))("%s", (_id, r) => {
    expect(r.failures).toEqual([]);
  });
});
