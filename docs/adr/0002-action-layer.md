# ADR 0002 — Action layer: SetupSpec contract, deterministic policy, outbound local agent

- Status: accepted
- Date: 2026-10-13

## Decision

1. Interpretation and execution are separated by a versioned Zod contract (`SetupSpec`), produced by two isolated LLM stages (facts → plan) and a deterministic evidence gate.
2. Safety decisions are made by a deterministic policy engine in a shared package (`@aop-inbox/core`) that runs on the server **and** on the device; LLM risk labels are floors only.
3. Execution happens in a separate local agent that connects **outbound** (SSE down, HTTPS up), executes argv only, snapshots and verifies, and keeps its own SQLite ledger.
4. Gateway transport is SSE + POST instead of WebSocket: works in Next.js route handlers on Node, survives proxies, no extra server.
5. pnpm workspace with `packages/core` and `packages/agent`; the Next app stays at the root.

## Consequences

The agent can't be talked into running something the server didn't plan, and the server can't make the agent run something its own policy rejects. Adding executors, recipes or providers doesn't change the contract. Revisit the transport if latency below ~2 s matters, and the policy allowlists as new tool configs appear.
