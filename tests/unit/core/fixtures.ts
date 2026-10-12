import type { SetupSpec, SetupStep } from "@aop-inbox/core";

export function step(overrides: Partial<SetupStep> & Pick<SetupStep, "id">): SetupStep {
  return {
    title: "Step",
    type: "command",
    instruction: "Do the thing",
    commands: [],
    needsUser: false,
    risk: "low",
    confidence: 0.95,
    evidence: { quote: "shown on screen", source: "screen" },
    dependsOn: [],
    ...overrides,
  };
}

export function spec(steps: SetupStep[], overrides: Partial<SetupSpec> = {}): SetupSpec {
  return {
    specVersion: 1,
    source: { itemId: "item-1", platform: "instagram" },
    contentType: "executable",
    summary: "Test setup",
    steps,
    suspiciousInstructions: [],
    ...overrides,
  };
}
