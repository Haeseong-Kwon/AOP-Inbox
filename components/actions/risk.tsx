import { ShieldAlert, ShieldCheck, ShieldHalf } from "lucide-react";
import type { Risk } from "@aop-inbox/core/browser";
import { cn } from "@/lib/utils";

const META: Record<Risk, { label: string; icon: typeof ShieldCheck; className: string }> = {
  low: { label: "Low risk", icon: ShieldCheck, className: "text-muted-foreground" },
  medium: { label: "Medium risk", icon: ShieldHalf, className: "text-foreground/85" },
  high: { label: "High risk", icon: ShieldAlert, className: "text-destructive" },
};

/** Icon + words, never color alone. Only high risk is loud. */
export function RiskBadge({ risk, className }: { risk: Risk; className?: string }) {
  const m = META[risk];
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium", m.className, className)}>
      <m.icon className="size-3.5" aria-hidden />
      {m.label}
    </span>
  );
}

export const DECISION_LABELS = {
  auto: "Runs automatically",
  approve: "Needs your approval",
  manual: "You do this",
  blocked: "Won't run automatically",
} as const;

export const STEP_TYPE_LABELS = {
  cli_install: "Install",
  mcp_add: "MCP server",
  config_write: "Config change",
  file_create: "New file",
  command: "Command",
  user_action: "Your step",
} as const;
