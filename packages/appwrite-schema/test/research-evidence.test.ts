import { describe, expect, it } from "vitest";

import { COLLECTIONS } from "../src/schema.js";

describe("research_evidence collection", () => {
  it("is server-written and indexed for survey recall plus deterministic source lookup", () => {
    const evidence = COLLECTIONS.find((collection) => collection.id === "research_evidence");

    expect(evidence?.permissions).toEqual([]);
    expect(evidence?.documentSecurity).toBe(true);
    expect(evidence?.attributes.map((attribute) => attribute.key)).toEqual(
      expect.arrayContaining([
        "ownerUserId",
        "surveyId",
        "sessionId",
        "transcriptId",
        "segmentIndex",
        "sourceText",
        "claim",
        "embedding",
        "embeddingModel",
        "contentHash",
      ]),
    );
    expect(evidence?.indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "by_survey", attributes: ["surveyId"] }),
        expect.objectContaining({ key: "source_claim_unique", type: "unique", attributes: ["transcriptId", "segmentIndex", "contentHash"] }),
      ]),
    );
  });
});
