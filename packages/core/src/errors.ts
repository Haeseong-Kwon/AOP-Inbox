/** Internal failure codes and the sentence a person sees for each. */
export const FAILURE_MESSAGES = {
  ANALYZE_SCHEMA: "We couldn't turn this content into a reliable setup plan.",
  ANALYZE_NO_ACTION: "This looks like knowledge to keep, not something to set up.",
  LOW_CONFIDENCE: "We're not confident we read the steps correctly, so they're shown as instructions only.",
  POLICY_DENIED: "This setup includes a step AOP Inbox won't run automatically.",
  DEVICE_OFFLINE: "Waiting for your Mac to come online.",
  DEVICE_PAUSED: "Execution is paused on your Mac.",
  APPROVAL_TIMEOUT: "This setup waited too long for approval and was closed.",
  EXEC_TIMEOUT: "A step took too long and was stopped.",
  EXEC_COMMAND_FAILED: "A step failed while running.",
  VERIFY_FAILED: "The setup ran, but AOP Inbox couldn't verify that it worked.",
  ROLLBACK_FAILED: "We couldn't fully restore your previous configuration.",
  USER_ACTION_REQUIRED: "This step needs you — finish it, then continue.",
  SPEC_INVALID: "The setup plan didn't pass validation on your Mac.",
  EXPIRED: "This setup waited too long for your Mac and was closed.",
} as const;

export type FailureCode = keyof typeof FAILURE_MESSAGES;

export function failureMessage(code: string | null | undefined): string {
  return (code && (FAILURE_MESSAGES as Record<string, string>)[code]) || "Something went wrong while applying this setup.";
}
