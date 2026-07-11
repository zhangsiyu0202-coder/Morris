# packages/observability

Per-module supplement to root `AGENTS.md` and `.kiro/steering/errors-and-observability.md`. Read those first. This file holds ONLY rules specific to this package.

## File map

| File | Owns |
|---|---|
| `src/logger.ts` | `createLogger(scope, traceId?)`, `maskSecret(value, visible=4)`, `LogLevel` / `LogFields` / `Logger` types. JSON line emission. |
| `src/retry.ts` | `withRetry`, `TransientProviderError`, `PermanentProviderError`, `RetryOptions`. Exponential backoff. |
| `src/index.ts` | `withErrorBoundary(scope, handler)` and re-exports. |
| `test/observability.test.ts` | Logger format, mask, retry classification. |

## Module-specific rules (binding)

- Public API surface (anything re-exported from `src/index.ts`) is part of every Function's contract — treat it as **stable**. Adding a parameter MUST be backward-compatible (optional + default). Removing or renaming requires updating every Function in `apps/functions/*` and the agent (`apps/agent/agent/logging.py`, `apps/agent/agent/retry.py`) in the same PR.
- The Python mirror (`apps/agent/agent/{logging,retry}.py`) MUST stay shape-equivalent: same level names, same retry classification, same JSON log fields. Diverging is a defect.
- This package MUST NOT import `@merism/contracts`, `node-appwrite`, `livekit-server-sdk`, or any business module. It is the lowest layer.
- `console.log` / `console.error` are the only allowed transports here. Routing to a different sink (e.g. Appwrite Functions runtime) belongs to the Function wrapper, not this package.
- Generated `traceId` MUST come from `node:crypto.randomUUID()` (already used). Do NOT switch to a random/non-UUID format — log aggregation expects it.

## Cross-module change triggers

| If you change | You MUST also update |
|---|---|
| `Logger` interface or `LogFields` shape | `apps/agent/agent/logging.py` create_logger signature, every `apps/functions/*/src/main.ts` logger usage, every test that snapshots a log line |
| `withRetry` signature or error class hierarchy | `apps/agent/agent/retry.py` and every provider adapter that throws these |
| `withErrorBoundary` return shape | Every Function `main.ts` that maps the result to `res.json(...)` |
| `maskSecret` default `visible` | Every snapshot containing masked values |

## Anti-patterns specific to this module

- A new "convenience" helper that bundles logger + retry + error boundary into one (these are deliberately separate so callers compose).
- A module-level singleton logger exported from `src/index.ts` (each Function invocation MUST get its own logger with its own `traceId`).
- Adding fields to log records that include raw secrets, raw prompts, raw audio, or PII. The logger is the wrong layer to enforce that — but contributing to the leak is a defect.
- A retry strategy that retries on every error class (must be `TransientProviderError` only).

## Enforcement (per-module)

```bash
pnpm -F @merism/observability typecheck
pnpm -F @merism/observability test
# When you change the Python-mirrored shape:
pnpm test:py
```
