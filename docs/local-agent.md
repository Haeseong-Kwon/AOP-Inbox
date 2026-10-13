# AOP Inbox Local Agent

`packages/agent` — a single bundled file (`dist/cli.js`) with **no runtime dependencies** (uses Node's `fetch`, `node:sqlite`, `child_process` and the macOS `security` tool). macOS (Apple Silicon and Intel), Node 22.13+.

```bash
pnpm --filter @aop-inbox/agent build
node packages/agent/dist/cli.js init --server https://your-inbox --code ABCDEF-GHJKMN [--launchd]
node packages/agent/dist/cli.js start
```

| Command | |
|---|---|
| `init` | Pair with a one-time code from Settings → Local Agent. Token → login Keychain. Creates `~/.aop-inbox/` (0700) and `~/aop-inbox-workspace`. `--launchd` installs a user LaunchAgent. |
| `start` | Connect (outbound SSE + HTTPS), heartbeat every 30 s, process jobs one at a time. |
| `status` | Server, device, pause state, auto-run consent, recent jobs from the ledger. |
| `doctor [--fix]` | Node, Claude Code + auth, config validity/permissions, workspace, Keychain token, gateway reachability, version. Separates auto-fixable from manual. |
| `logs [jobId]` | Local log lines (redacted). |
| `undo <jobId>` | Roll back a finished job from the local ledger (works offline; reconciles later). |
| `pause` / `resume` | Local kill switch. Jobs are received but not run. |
| `service install|uninstall` | User-level LaunchAgent only — never a root daemon. |
| `uninstall [--purge]` | Removes the token and LaunchAgent (`--purge` also `~/.aop-inbox`); workspace is kept. |

## State

`~/.aop-inbox/config.json` (no credentials, 0600) · `ledger.db` (SQLite: jobs, steps, snapshots, event outbox, logs) · `snapshots/<jobId>/` (retention 30 days) · `logs/`. Events go to the outbox first and are delivered in order when online.

## Executors

`Executor { supports, dryRun, run, verify, rollback? }` — `manual` (person steps) → `claude-code` (MCP via `claude mcp add/get/remove`, argv built from `step.mcp`; experimental headless `claude -p` with a one-step prompt, off unless `headlessClaude: true`) → `file` (structured `change`, atomic writes, diffs) → `shell` (argv after runtime path/package-manager checks). Future: Codex, Computer Use, other shells — same interface.

## Updates

The agent never updates itself. Settings shows “update available”; you rebuild/reinstall explicitly. No runtime downloads of code.
