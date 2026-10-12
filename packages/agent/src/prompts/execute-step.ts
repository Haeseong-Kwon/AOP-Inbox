import type { SetupStep } from "@aop-inbox/core";

/**
 * Prompt for the (experimental, off by default) headless Claude Code executor.
 * It receives exactly ONE approved step — never the original content.
 */
export const EXECUTE_STEP_PROMPT_VERSION = 1;

export function executeStepPrompt(step: SetupStep, ctx: { allowedPaths: string[]; workspace: string }): string {
  return `You are executing exactly one approved setup step on the user's Mac.

Step: ${step.title}
Intent: ${step.instruction}
Approved command candidates (run only these, verbatim):
${step.commands.map((c) => `- ${c}`).join("\n") || "- (none)"}

Working directory: ${ctx.workspace}
Allowed write paths:
${ctx.allowedPaths.map((p) => `- ${p}`).join("\n")}

Forbidden operations:
- sudo or any privilege escalation
- reading or writing ~/.ssh, keychains, browser profiles, cloud credentials, .env files
- downloading and executing scripts (curl | sh and similar)
- network uploads of any local data
- changing system settings, launch agents or daemons

Rules:
- Do not perform unrelated work. Do not expand scope.
- Do not retrieve, print or store secrets.
- Do not modify files outside the allowed paths.
- If the step cannot be completed exactly as approved, stop and explain why instead of improvising.`;
}
