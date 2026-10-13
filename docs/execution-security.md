# Execution security

Order that is never broken: **Extract → Structure → Validate → Policy → Dry Run → Approve → Snapshot → Execute → Verify → Record → Follow up.** No LLM output ever reaches a shell; the agent executes argv lists built from validated, policy-checked specs.

## Risk model (packages/core/policy.ts)

The model's `risk` is only a floor. Each rule can raise risk, nothing lowers it.

| | Examples | Decision |
|---|---|---|
| low | workspace files of plain-data types, read-only checks, `npm install --ignore-scripts` in the workspace, `git clone https://github.com/a/b`, HTTPS MCP for the workspace project | approval by default; auto-run only if the person enabled it on the device **and** in Settings |
| medium | global installs, Homebrew, pip, `npx`, stdio MCP servers, `~/.claude/settings.json` safe keys, shell-profile `export` of tool locations/PATH, unknown commands, non-data workspace files | **always** needs approval (“Approve once”); never auto |
| high | sudo/su, `curl … | sh`, pipes/chains/substitution, wrappers (`env`, `xargs`, `find -exec`…), interpreters with code, SSH/Keychain/browser/cloud credentials, outside allowed paths, hidden workspace paths, Claude hooks/permissions/statusLine…, package scripts, steps linked to suspicious instructions, unparseable or obfuscated commands | **blocked** — shown as manual instructions only |

Confidence: ≥ 0.85 normal · 0.70–0.84 review required (never auto) · < 0.70 manual only. Steps that run something but have no source quote are manual only.

## Hard deny & analysis

`packages/core/command.ts` tokenizes like a shell (quotes, escapes, operators, redirects, `$()`/backticks, heredocs, comments, brace/ANSI-C expansion, invisible characters) and classifies each segment; unclassified commands default to medium. Obfuscation (base64/xxd decode, `eval`, `sh -c`, dynamic command names) is high/denied.

## Paths

`packages/core/paths.ts` resolves `~`, `$HOME`, `..` and — on the device — symlinks through `realpath` of the nearest existing ancestor. Zones: workspace (low) · `~/.claude*` and shell profiles (medium, approval) · agent state, sensitive locations, everything else (blocked). At execution time `checkRuntimePaths()` re-resolves every existing path argument (catches symlinks planted by earlier steps) and `checkPackageManagerConfig()` refuses installs next to `.npmrc`, `.pnpmfile.cjs`, `.yarnrc.yml`, `bunfig.toml`, `pip.conf`.

## Execution hygiene (agent)

argv only (`shell: false`), minimal environment (no inherited tokens), own process group killed on timeout (10 min/step), output redacted and capped, snapshots before any file change (refuses symlinks, > 10 MB files), one job at a time, local kill switch + dashboard kill switch, approvals re-checked locally.

## Approvals & honesty

Medium never runs silently; “Approve once” only (no “always allow”). High never runs. The UI shows actual commands, affected files, risk reasons and whether Undo is complete — package installs are reported as *partially* reversible, never “fully reversible”.

## Secrets & privacy

API keys are always a person step; secret-looking values in content are redacted before they reach the spec, logs, the ledger or the server. Device tokens are random 256-bit values stored only as SHA-256 on the server and in the macOS Keychain on the Mac. Paths are reported home-relative.
