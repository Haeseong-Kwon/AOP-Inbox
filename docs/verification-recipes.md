# Verification recipes

“Exit code 0” is not success. Steps declare a recipe; the agent runs it **before** (idempotency: “Already configured” → skip) and **after** (verify) each step. A failed verification rolls the job back.

Catalog (contract, `packages/core/src/recipes.ts`) — implementations in `packages/agent/src/recipes`:

| id | args | probe |
|---|---|---|
| `node-installed` | `minVersion?` | `node --version` |
| `command-exists` | `command` | PATH lookup (no exec) |
| `package-installed` | `manager` (npm · npm-global · brew · pip), `name` | workspace `node_modules`, `npm ls -g --json`, `brew list --versions`, `pip3 show` |
| `file-contains` | `path`, `text` | read (allowed zones only, ≤ 2 MB) |
| `json-key-equals` | `path`, `key`, `value?` | parse + dot-path lookup |
| `directory-exists` | `path` | stat |
| `claude-mcp-connected` | `name` | `claude mcp get <name>` |
| `http-healthcheck` | `url` (localhost only) | GET with 3 s timeout |

Rules: every recipe is read-only, has a version and a Zod schema for its args, runs only fixed argv lists written in the agent, and may only read non-sensitive zones. Adding one = catalog entry + implementation + test. Structured file changes (`json_merge`, `file_write`, `append_line`) are verified intrinsically by the file executor.
