/**
 * Secret redaction for logs, ledgers, specs and anything shown back to the user.
 * Conservative: false positives cost a "[redacted]", false negatives leak keys.
 */
const PATTERNS: [RegExp, string][] = [
  [/\b(sk-(?:proj-|ant-|or-)?[A-Za-z0-9_-]{16,})/g, "sk-[redacted]"],
  [/\b(gh[pousr]_[A-Za-z0-9]{20,})/g, "gh_[redacted]"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, "github_pat_[redacted]"],
  [/\b(xox[abposr]-[A-Za-z0-9-]{10,})/g, "xox-[redacted]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "AKIA[redacted]"],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, "AIza[redacted]"],
  [/\b(npm_[A-Za-z0-9]{30,})/g, "npm_[redacted]"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, "[redacted private key]"],
  [/(authorization\s*[:=]\s*)(bearer\s+)?[^\s"',;]+/gi, "$1$2[redacted]"],
  [/(\bbearer\s+)[A-Za-z0-9._~+/-]{12,}=*/gi, "$1[redacted]"],
  [/(cookie\s*[:=]\s*)[^\n"']+/gi, "$1[redacted]"],
  [/(\b[A-Z0-9_]*(?:API_?KEY|TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE_KEY|ACCESS_KEY)[A-Z0-9_]*\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s"']+)/gi, "$1[redacted]"],
  [/(\b(?:password|passwd|pwd|secret|token|api[_-]?key)\b\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s"',;]+)/gi, "$1[redacted]"],
];

export function redactSecrets(text: string): string {
  return PATTERNS.reduce((acc, [re, replacement]) => acc.replace(re, replacement), text);
}

export function containsSecret(text: string): boolean {
  return redactSecrets(text) !== text;
}
