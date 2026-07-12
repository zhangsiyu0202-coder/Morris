import { generateText } from "ai";

import { resolveDashScopeSpeechConfig } from "../src/mastra/dashscope-config";
import { voiceWorkerModel } from "../src/mastra/model";

async function main() {
  const prompt = process.argv.slice(2).join(" ").trim() || "请只回复 OK";
  const config = resolveDashScopeSpeechConfig();
  const result = await generateText({
    model: voiceWorkerModel,
    prompt,
  });

  console.log(
    JSON.stringify(
      {
        baseUrl: config.qwenLlmBaseUrl,
        model: config.qwenLlmModel,
        prompt,
        text: result.text,
      },
      null,
      2,
    ),
  );
}

await main();
