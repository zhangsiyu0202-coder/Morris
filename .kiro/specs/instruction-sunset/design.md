# Design — instruction-sunset

## Data flow

```text
W5a: surveys documents
  -> backfill (blank instruction only)
  -> composeInstructionFromLegacy
  -> Survey.instruction

W5b: Survey.instruction
  -> SurveyDraft
  -> buildInterviewFlowConfigFromDraft
  -> room metadata { flowConfig, runtimeStudy }
  -> voice worker / interviewee progress
```

`runtimeStudy` remains a UI projection. It no longer owns research intent;
only its question/section structure remains in room metadata. `flowConfig` is
the only AI moderator operating manual and is the only metadata shape the
worker uses for orchestration.

## W5a backfill contract

The script reads one page at a time with an Appwrite cursor. For each survey:

1. Trim `instruction`; skip it if non-empty.
2. Parse `flowConfig` defensively as an object.
3. Call the contracts-owned legacy composer with the three flow values and
   `moderatorInstruction`.
4. If the composer returns markdown, emit it in dry-run or update only the
   `instruction` and `updatedAt` fields in apply mode.
5. If every legacy value is blank, report the row as unresolved and do not
   fabricate content.

The script never rewrites `flowConfig` in W5a. This makes the advisory release
reversible and preserves the fallback until W5b gates pass.

## W5b destructive schema contract

The declarative schema remains authoritative. `schema:apply` computes declared
attributes versus deployed attributes. In normal mode it can only create or
update declarations. With `--allow-destructive`, it may delete exactly
`surveys.moderatorInstruction`, after verifying the live attribute exists and
the operator supplied an explicit migration note. Appwrite's Node Server SDK
documents this as `databases.deleteAttribute({ databaseId, collectionId, key })`:
https://appwrite.io/docs/references/cloud/server-nodejs/databases#deleteAttribute

## Failure behavior

- A malformed `flowConfig` is treated as `{}` and reported unresolved; no
  document is overwritten.
- An Appwrite update failure stops the script with the last cursor printed,
  so rerunning is safe.
- A blank instruction after W5b fails closed at the issue-token/composer
  boundary; it cannot start an interview with an invented operating manual.
