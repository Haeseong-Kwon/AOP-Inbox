// Browser-safe surface (no node:* imports). Client components import from "@aop-inbox/core/browser".
export * from "./setup-spec";
export * from "./state";
export * from "./errors";
export { maxRisk } from "./command";
export * from "./plan";
export * from "./redact";
// Type-only: erased at build time, so policy's node:fs dependency never reaches the browser.
export type { SpecPolicy, StepPolicy, StepDecision, SpecDecision } from "./policy";
