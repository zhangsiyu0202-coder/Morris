# LiteLLM gateway requirements

## Goal

Route Merism's server-side DeepSeek text generation through one internal
LiteLLM Proxy using only official `deepseek-v4-flash`.

## Requirements

1. The proxy SHALL expose `deepseek-v4-flash` and SHALL route it to
   `deepseek/deepseek-v4-flash`.
2. The proxy SHALL NOT configure `deepseek-v4-pro`, `deepseek-chat`, or
   `deepseek-reasoner`.
3. Morris and the session, survey, and evidence text-analysis paths SHALL use
   the proxy through a shared TypeScript provider factory.
4. The analysis Functions SHALL use LiteLLM credentials and SHALL NOT retain
   direct DeepSeek environment variables.
5. Gemini Live, Gemini visual analysis, Jina embeddings, and Cohere reranking
   SHALL retain their existing provider adapters.
6. The local proxy SHALL bind only to loopback, while Docker workloads access
   it over the internal `litellm` hostname.
7. Verification SHALL include `/v1/models`, one genuine V4-Flash completion,
   TypeScript typechecks, focused tests, deployed Function readiness, and
   malformed-payload execution checks.
