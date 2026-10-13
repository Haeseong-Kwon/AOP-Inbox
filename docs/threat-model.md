# Threat model — action layer

| Threat | Mitigation | Residual risk |
|---|---|---|
| **Prompt injection** in reels, pages, PDFs, READMEs, guides | Content is data: two isolated stages, structured outputs, Stage 2 sees facts only, suspicious instructions recorded and escalate linked steps to high; red-team fixtures (`evals/`, `tests/integration/actions.test.ts`) | A model may still mis-classify; the deterministic evidence gate + policy decide what can run, not the model |
| **Hallucinated / spliced commands** | Commands must match facts verbatim; MCP specs must match one fact command exactly; file payloads must appear in facts; dropped content keeps its risk floor | Content that literally contains a harmful-but-“low” command still needs approval unless auto-run is on |
| **Malicious creator guide** | Attached guides are evidence like any content — same extraction, gate and policy | Same as above |
| **Remote script / malicious package** | `curl|sh`, URL/tarball/Git installs, unofficial registries, `npx` are medium/high; low only for script-free registry installs; package-manager project config refused at runtime | A malicious package on the official registry installed with approval |
| **Credential theft / exfiltration** | Sensitive path patterns denied in commands and file changes; uploads (`curl -d/-T/-F`), SSH/scp/nc denied; env dumps high; child env stripped; output redacted | Novel exfil channels in medium commands the person approves |
| **Path escape / symlink attack** | realpath zones, `..` handling, `checkRuntimePaths()` on every existing argument, snapshot refuses symlinks, APFS case-insensitive matching | TOCTOU between check and exec within a single step (tiny window, same user) |
| **Shell injection** | argv execution only; anything needing a shell is high; tokenizer rejects comments, control/invisible chars, unbalanced quotes | Parser differentials for exotic syntax (fail-safe: unknown → medium/high) |
| **Config-as-code** (hooks, package scripts, dotfiles, tool configs, shell profiles) | Allowlists: Claude settings keys, plain-data workspace files, tool-location/PATH exports; hidden workspace paths and known code-running configs blocked | An unlisted non-hidden config file read by some tool → still needs approval with a diff |
| **Supply chain (agent)** | Zero runtime deps, pinned lockfile, single bundle, no self-update, no runtime downloads | Build-time dependencies (esbuild, zod) |
| **Device token theft** | 256-bit token, Keychain storage, SHA-256 on server, revoke in Settings, token only valid for `/api/agent/*` | Token visible in `security` argv briefly during `init` to the same user; a stolen token can only fetch that user's dispatched jobs/report events — it can't approve anything |
| **Cross-user access / IDOR** | Every job/spec/device/notification query filters by owner; agent events require job.device = device and job.user = device.user | — |
| **Pairing brute force** | 12-char codes (public lookup + secret), 5 wrong secrets burn that code, 10-min TTL | Flooding the pairing endpoint (add edge rate limiting in production) |
| **Rollback failure** | Snapshots before changes, hash-checked restore, honest reversibility (packages = partial), `ROLLBACK_FAILED` surfaced | External side effects (accounts, remote state, uninstalls) can't be undone |
| **Approval fatigue** | No “always allow”, medium never auto, auto-run for low is opt-in twice (device + dashboard) | Person approves without reading |
