# Local development lifecycle

Use one terminal command for a normal local session:

```bash
pnpm dev:up
```

It validates required environment variables and fixed local endpoints, starts
Docker infrastructure, waits for Appwrite and LiveKit HTTP readiness, applies
the Appwrite schema, confirms all production-path Function deployments are
ready, then starts and waits for Web, Mastra, and the voice worker in that
order. The managed ports are fixed: Web `3000`, Mastra `4111`, and voice worker
health `8082`. `Ctrl-C` stops only those three managed Node processes; Docker
continues to run.

`dev:up` intentionally refuses to take over an occupied managed port. Run
`pnpm dev:status` to see the failing layer, then stop the other startup owner
before retrying. This prevents a stale Next server or a duplicate LiveKit worker
from being mistaken for the new session.

Run the complete verification with:

```bash
pnpm dev:smoke
```

The smoke command requires `dev:up` to be healthy. It checks all HTTP readiness
targets and deployed Functions, executes the deployed `issueLivekitToken`
Function with malformed input, runs the Appwrite + LiveKit token-issuance smoke,
and runs the dispatched LiveKit worker flow smoke. The final step calls the
configured LLM provider and can consume provider usage.

For a fast diagnostic without writes or provider calls:

```bash
pnpm dev:status
```

## First-time Function setup

`dev:up` verifies Function deployments; it does not overwrite them. On a new
Appwrite volume, follow [deploy-functions.md](./deploy-functions.md) once to
create and deploy the required Functions. This keeps normal startup
non-destructive while ensuring `dev:smoke` exercises the real deployed path.
