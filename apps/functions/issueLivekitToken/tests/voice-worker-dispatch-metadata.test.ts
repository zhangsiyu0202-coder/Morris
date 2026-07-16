import { describe, expect, it } from "vitest";

import {
  buildInterviewRoomMetadataFromDraft,
  InterviewRoomMetadataSchema,
} from "@merism/contracts";

import { buildVoiceWorkerDispatchMetadata } from "../src/deps";

describe("buildVoiceWorkerDispatchMetadata", () => {
  it("preserves the complete room metadata required by the fail-closed worker", () => {
    const roomMetadata = buildInterviewRoomMetadataFromDraft({
      surveyId: "survey-1",
      sessionId: "session-1",
      draft: {
        title: "Dispatch contract test",
        instruction: "Conduct a short interview.",
        sections: [
          {
            title: "Introduction",
            objective: "Collect one answer.",
            questions: [
              {
                questionText: "How are you today?",
                questionType: "open_ended",
                probeLevel: "standard",
                probeInstruction: "",
                options: [],
              },
            ],
          },
        ],
      },
    });

    const dispatchMetadata = buildVoiceWorkerDispatchMetadata(JSON.stringify(roomMetadata));
    const parsed = InterviewRoomMetadataSchema.parse(JSON.parse(dispatchMetadata));

    expect(parsed.sessionId).toBe("session-1");
    expect(parsed.surveyId).toBe("survey-1");
    expect(parsed.flowConfig).toBeDefined();
    expect(parsed.runtimeStudy).toBeDefined();
  });
});
