# LiteLLM gateway tasks

- [x] Verify current DeepSeek model IDs against official API documentation.
- [x] Add a digest-pinned internal LiteLLM Proxy with only V4-Flash.
- [x] Add the shared OpenAI-compatible provider factory.
- [x] Route Morris and text-analysis callers through the factory.
- [x] Restrict analysis Function variables to LiteLLM and remove direct
      DeepSeek variables.
- [x] Verify a genuine V4-Flash request, types, focused tests, deployment,
      and malformed-payload Function executions.
