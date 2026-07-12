import { initializeLogger } from "@livekit/agents";

import { resolveDashScopeSpeechConfig } from "../src/mastra/dashscope-config";
import { DashScopeQwenRealtimeTTS } from "../src/mastra/dashscope-qwen-tts";

async function main() {
  initializeLogger({ pretty: false, level: "silent" });

  const text = process.argv.slice(2).join(" ").trim() || "你好，这是 Merism TS 语音原型的 TTS 连通性测试。";
  const config = resolveDashScopeSpeechConfig();
  const ttsProvider = new DashScopeQwenRealtimeTTS(config);
  const stream = ttsProvider.synthesize(text);

  let frameCount = 0;
  let totalSamples = 0;
  let sampleRate = 0;

  for await (const chunk of stream) {
    frameCount += 1;
    totalSamples += chunk.frame.samplesPerChannel;
    sampleRate = chunk.frame.sampleRate;
  }

  console.log(
    JSON.stringify(
      {
        endpoint: config.qwenTtsEndpoint,
        model: config.qwenTtsModel,
        voice: config.qwenTtsVoice,
        text,
        frameCount,
        sampleRate,
        durationMs: sampleRate > 0 ? Math.round((totalSamples / sampleRate) * 1000) : 0,
      },
      null,
      2,
    ),
  );
}

await main();
