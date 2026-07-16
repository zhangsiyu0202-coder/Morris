# ADR 0017: Gemini-Only Post-Session Visual Analysis

Date: 2026-07-16

## Status

Accepted. Supersedes ADR-0010 and restores ADR-0004's provider choice. ADR-0005
remains authoritative for the asynchronous Function, deterministic job claim,
and Gemini-file cleanup lifecycle.

## Context

The shipped `analyzeSessionVisual` Function already used the PostHog-shaped
Gemini Files workflow: upload a recording once, wait until it is active, reuse
its URI for independent offset-based segment analysis, and delete/reap the
remote file. Its final text-only consolidation was still sent to DeepSeek.
That made one visual-analysis job depend on two providers and contradicted the
requested Gemini-based video-analysis boundary.

## Decision

`apps/functions/analyzeSessionVisual` uses Gemini for every model call:

1. Upload the private Appwrite recording to Gemini Files API and record the
   file name before waiting for `ACTIVE`.
2. Reuse the returned URI for 60-second `videoMetadata.startOffset/endOffset`
   segment requests, with bounded parallelism and partial-result handling.
3. Send the successful segment observations to Gemini for JSON-schema-backed
   session consolidation, with local Zod validation and at most three
   correction-feedback attempts.
4. Clamp the result against deterministic segment evidence, patch the existing
   session report, and delete the Gemini file. `sweepGeminiFiles` is the crash
   recovery backstop.

The text-report chain (`analyzeSession`, `analyzeSurvey`, Morris) still uses
DeepSeek. Realtime speech and live-interview provider choices are unchanged.

## Consequences

- `analyzeSessionVisual` no longer reads `DEEPSEEK_API_KEY`, creates a
  DeepSeek client, or ships `@ai-sdk/deepseek` / `ai` as Function runtime
  dependencies.
- Gemini structured output is still parsed and semantically validated locally;
  schema-compliant JSON is not trusted without the existing clamp layer.
- The public `VisualAnalysisOutput` contract, Appwrite job idempotency, report
  patching, and researcher UI require no change.

## Alternatives considered

- Keep DeepSeek consolidation: rejected because it leaves the requested visual
  pipeline split across providers.
- Switch to Qwen Omni: rejected because it loses the Files API offset slicing
  and is superseded by this ADR.
- Re-upload the recording for consolidation: rejected because consolidation is
  text-only and receives the validated segment observations instead.

## References

- PostHog [`a2_upload_video_to_gemini.py`](https://github.com/PostHog/posthog/blob/master/posthog/temporal/session_replay/session_summary/activities/video_based/a2_upload_video_to_gemini.py): track-before-wait and rollback cleanup.
- PostHog [`a4_analyze_video_segment.py`](https://github.com/PostHog/posthog/blob/master/posthog/temporal/session_replay/session_summary/activities/video_based/a4_analyze_video_segment.py): one uploaded URI plus per-segment offsets.
- PostHog [`a6_consolidate_video_segments.py`](https://github.com/PostHog/posthog/blob/master/posthog/temporal/session_replay/session_summary/activities/video_based/a6_consolidate_video_segments.py): Gemini JSON schema, local validation, and correction-feedback retries.
- [Gemini video understanding](https://ai.google.dev/gemini-api/docs/generate-content/video-understanding): Files API and clipping offsets.
- [Gemini structured outputs](https://ai.google.dev/gemini-api/docs/generate-content/structured-output): JSON schema requests still require application-side semantic validation.
