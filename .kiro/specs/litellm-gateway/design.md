# LiteLLM gateway design

## Boundary

```text
Morris / text-analysis Functions
  -> @merism/llm
  -> LiteLLM Proxy (internal)
  -> deepseek/deepseek-v4-flash
```

`@merism/llm` is a provider factory only. It owns no prompt, domain logic,
credential storage, retry policy, or persistence.

## Configuration

- `infra/litellm/config.yaml` declares the sole public model identifier.
- Docker supplies `DEEPSEEK_API_KEY` only to LiteLLM.
- Server callers supply `LITELLM_BASE_URL` and `LITELLM_API_KEY`.
- The Function variable helper rewrites host `localhost:4000` to
  `litellm:4000` for Appwrite runtime containers.

## Non-goals

- No browser access to LiteLLM.
- No generic multi-provider model catalog.
- No migration of Gemini realtime/visual or AihubMix embedding/rerank flows.
- No direct-provider fallback from a caller.
