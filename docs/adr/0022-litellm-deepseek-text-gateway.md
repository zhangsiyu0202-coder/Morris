# ADR 0022: LiteLLM gateway for DeepSeek V4-Flash text calls

Date: 2026-07-17

## Status

Accepted.

## Context

Morris and the three post-session text-analysis Functions previously created
provider clients independently. That duplicated provider configuration and put
the DeepSeek credential in multiple server runtimes. The product needs one
server-side text-model gateway while retaining the existing provider boundaries:
Gemini Live remains the realtime interview provider, Gemini remains the visual
analysis provider, and AihubMix remains the Jina embedding/Cohere reranking
provider.

DeepSeek's official API lists `deepseek-v4-flash` and `deepseek-v4-pro` as the
current model identifiers. Its `deepseek-chat` and `deepseek-reasoner` aliases
are scheduled for retirement on 2026-07-24 15:59 UTC. The selected project
model is `deepseek/deepseek-v4-flash` for every LiteLLM-routed request.

## Decision

- Run LiteLLM Proxy as an internal Docker service. It is exposed to the host
  only on `127.0.0.1:4000`; Appwrite Function containers reach it through the
  Docker `litellm` hostname.
- Configure exactly one proxy model: public name `deepseek-v4-flash`, upstream
  identifier `deepseek/deepseek-v4-flash`. No V4-Pro or legacy DeepSeek model
  alias is configured.
- Add `@merism/llm`, a narrow OpenAI-compatible provider factory. It owns
  LiteLLM URL normalization and prevents each caller from inventing its own
  provider client.
- Route Morris, instruction generation, notebook generation, guide AI, and
  `analyzeSession`, `analyzeSurvey`, and `analyzeEvidence` through that
  factory. Their Function environments receive `LITELLM_*`, not direct
  `DEEPSEEK_*` credentials.
- Keep DeepSeek's upstream key only in the LiteLLM container environment. The
  LiteLLM access key remains server-only and is never returned to a browser.
- Keep the existing AihubMix embedding/reranking and Gemini paths direct. They
  do not use the OpenAI chat-completions contract and have separate product
  responsibilities.

## Consequences

- Text callers use one stable local OpenAI-compatible endpoint and one model
  identifier. Provider changes can be made at the proxy boundary.
- LiteLLM availability is now a dependency of text generation. There is no
  direct-DeepSeek fallback, because a fallback would defeat the secret and
  observability boundary.
- The local proxy image is pinned by digest. Updating LiteLLM requires an
  intentional digest change plus `/v1/models` and a real V4-Flash request.
- `scripts/set-function-vars.sh` has Function-specific analysis defaults and
  removes only obsolete direct DeepSeek variables from those Functions.

## Alternatives considered

### Keep per-process DeepSeek clients

Rejected. It multiplies credentials and makes a provider cutover an
application-wide source edit.

### Route Gemini, embedding, and reranking through the same proxy now

Rejected. It would blur the two LLM chains and the existing AihubMix/Gemini
adapter boundaries without a product requirement.

### Use `deepseek-chat` / `deepseek-reasoner`

Rejected. They are documented compatibility aliases with a published
retirement date.

## Verification

- LiteLLM `/v1/models` returns only `deepseek-v4-flash`.
- A real OpenAI-compatible completion through LiteLLM with that model returns
  `READY.`.
- The three deployed analysis Functions return their expected `400` response
  for an empty payload after the new deployment is ready.

## References

- https://docs.litellm.ai/
- https://api-docs.deepseek.com/
- https://ai-sdk.dev/providers/openai-compatible-providers
