import { describe, expect, it } from "vitest";

import {
  buildFunAsrFinishTask,
  buildFunAsrRecognitionTask,
} from "./dashscope-funasr-protocol.js";

describe("FunASR duplex protocol", () => {
  it("uses the same recognition task payload for transcript and boundary streams", () => {
    expect(buildFunAsrRecognitionTask("task-1", { funAsrModel: "fun-asr-realtime", language: "zh" })).toEqual({
      header: { action: "run-task", task_id: "task-1", streaming: "duplex" },
      payload: {
        task_group: "audio",
        task: "asr",
        function: "recognition",
        model: "fun-asr-realtime",
        parameters: {
          format: "pcm",
          sample_rate: 16000,
          language_hints: ["zh"],
          disfluency_removal_enabled: false,
          inverse_text_normalization_enabled: true,
        },
        input: {},
      },
    });
  });

  it("finishes the same duplex task it started", () => {
    expect(buildFunAsrFinishTask("task-1")).toEqual({
      header: { action: "finish-task", task_id: "task-1", streaming: "duplex" },
      payload: { input: {} },
    });
  });
});
