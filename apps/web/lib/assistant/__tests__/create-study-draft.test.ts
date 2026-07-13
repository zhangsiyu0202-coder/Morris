import { describe, it, expect, vi, beforeEach } from "vitest";
import fc from "fast-check";
import { SurveyDraftSchema } from "@merism/contracts";

// Mock server-only deps at module boundary (testing.md::Test double pattern).
// createStudyDraft 静态 import 了 @/lib/actions/survey; 整个 tools 链还拉 node-appwrite
// 等 server-only 模块, 沿用 install-mocks 集中 fake。
vi.mock("@/lib/actions/survey", async () => (await import("./fixtures/install-mocks")).fakeSurveyActionsModule());
vi.mock("@/lib/queries", async () => (await import("./fixtures/install-mocks")).fakeQueriesModule());
vi.mock("@/lib/server/notebooks", async () => (await import("./fixtures/install-mocks")).fakeNotebooksServerModule());
vi.mock("@/lib/server/embedder-qwen", async () => (await import("./fixtures/install-mocks")).fakeEmbedderQwenModule());
vi.mock("@/lib/instruction/generator", async () => (await import("./fixtures/install-mocks")).fakeInstructionGeneratorModule());
vi.mock("node-appwrite", async () => (await import("./fixtures/install-mocks")).fakeNodeAppwriteModule());

import { createSurveyFromDraft } from "@/lib/actions/survey";
import { generateInstructionBaseline } from "@/lib/instruction/generator";
import { buildCreateStudyDraftTool } from "../tools/create-study-draft";
import { buildAssistantTools } from "../tools";

const mockCreate = vi.mocked(createSurveyFromDraft);
const mockGenerate = vi.mocked(generateInstructionBaseline);

const validDraft = {
  title: "差旅住宿预订习惯",
  researchGoal: "了解经常出差者如何挑选与预订住宿",
  targetAudience: "每月出差两次以上的上班族",
  introScript: "你好,感谢参与这次访谈,我们想聊聊你的差旅住宿预订习惯。",
  sections: [
    {
      title: "预订渠道",
      objective: "了解受访者用什么渠道订住宿",
      questions: [
        { questionText: "你最近一次出差是怎么订住宿的?", questionType: "open_ended" },
        { questionText: "为什么选这个渠道?", questionType: "open_ended" },
      ],
    },
  ],
};

beforeEach(() => {
  mockCreate.mockReset();
  mockGenerate.mockReset();
  mockGenerate.mockResolvedValue("## 研究意图\n(mock baseline)");
});

describe("createStudyDraft: auth-conditional execute behavior", () => {
  it("anonymous (ownerUserId null) → preview only, never writes", async () => {
    const built = buildCreateStudyDraftTool({ ownerUserId: null });
    const res = await (built.spec as any).execute(validDraft);
    expect(res.artifact).toMatchObject({ persisted: false });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("signed-in → execute persists via createSurveyFromDraft", async () => {
    // AI SDK 6 原生 HITL: 当 needsApproval=true 时 execute 只在用户批准后被调用。
    // 单测里直接调 execute 等价于"AI SDK 已批准放行"的状态, 期望真正写库。
    mockCreate.mockResolvedValue({ surveyId: "sv9", url: "/studies/sv9" });
    const built = buildCreateStudyDraftTool({ ownerUserId: "u1" });
    const res = await (built.spec as any).execute(validDraft);
    expect(mockCreate).toHaveBeenCalledOnce();
    expect(res.artifact).toMatchObject({ persisted: true, surveyId: "sv9", url: "/studies/sv9" });
  });

  it("invalid draft (choice question without options) → tool error, no write", async () => {
    const built = buildCreateStudyDraftTool({ ownerUserId: "u1" });
    const bad = {
      ...validDraft,
      sections: [
        {
          title: "渠道",
          objective: "x",
          questions: [{ questionText: "选哪个?", questionType: "single_choice", options: [] }],
        },
      ],
    };
    const res = await (built.spec as any).execute(bad);
    expect(res.artifact).toMatchObject({ error: true });
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe("createStudyDraft: two-step baseline instruction generation (ADR-0015 Wave 3)", () => {
  it("signed-in with empty instruction → generates baseline and persists it", async () => {
    mockCreate.mockResolvedValue({ surveyId: "sv9", url: "/studies/sv9" });
    mockGenerate.mockResolvedValue("## 研究意图\n了解差旅预订决策");
    const built = buildCreateStudyDraftTool({ ownerUserId: "u1" });
    await (built.spec as any).execute(validDraft);

    expect(mockGenerate).toHaveBeenCalledOnce();
    // Step 2 receives the flattened questions (in order) + title + legacy hints.
    const genArg = mockGenerate.mock.calls[0][0];
    expect(genArg.surveyTitle).toBe(validDraft.title);
    expect(genArg.questions.map((q: { text: string }) => q.text)).toEqual([
      "你最近一次出差是怎么订住宿的?",
      "为什么选这个渠道?",
    ]);
    expect(genArg.legacy).toMatchObject({ researchGoal: validDraft.researchGoal });
    // The generated instruction lands on the persisted draft.
    const persisted = mockCreate.mock.calls[0][0];
    expect(persisted.instruction).toBe("## 研究意图\n了解差旅预订决策");
  });

  it("skips generation when Morris already supplied a non-empty instruction", async () => {
    mockCreate.mockResolvedValue({ surveyId: "sv9", url: "/studies/sv9" });
    const built = buildCreateStudyDraftTool({ ownerUserId: "u1" });
    await (built.spec as any).execute({ ...validDraft, instruction: "研究员手写的说明" });

    expect(mockGenerate).not.toHaveBeenCalled();
    expect(mockCreate.mock.calls[0][0].instruction).toBe("研究员手写的说明");
  });

  it("best-effort: generator failure still persists the study with empty instruction", async () => {
    mockCreate.mockResolvedValue({ surveyId: "sv9", url: "/studies/sv9" });
    mockGenerate.mockRejectedValue(new Error("deepseek down"));
    const built = buildCreateStudyDraftTool({ ownerUserId: "u1" });
    const res = await (built.spec as any).execute(validDraft);

    expect(mockGenerate).toHaveBeenCalledOnce();
    expect(mockCreate).toHaveBeenCalledOnce();
    expect(mockCreate.mock.calls[0][0].instruction).toBe("");
    expect(res.artifact).toMatchObject({ persisted: true, surveyId: "sv9" });
  });

  it("anonymous preview does NOT trigger instruction generation (lossless, no LLM)", async () => {
    const built = buildCreateStudyDraftTool({ ownerUserId: null });
    await (built.spec as any).execute(validDraft);
    expect(mockGenerate).not.toHaveBeenCalled();
  });
});

describe("createStudyDraft: metadata reflects auth", () => {
  it("anonymous → destructive false (preview path)", () => {
    expect(buildCreateStudyDraftTool({ ownerUserId: null }).metadata.annotations.destructive).toBe(false);
  });
  it("signed-in → destructive true, type write", () => {
    const m = buildCreateStudyDraftTool({ ownerUserId: "u1" }).metadata;
    expect(m.annotations.destructive).toBe(true);
    expect(m.type).toBe("write");
  });
});

describe("createStudyDraft: needsApproval gates AI SDK pause/resume (R3 / SDD Wave 3)", () => {
  it("anonymous → needsApproval returns false (no pause, direct execute)", async () => {
    const built = buildCreateStudyDraftTool({ ownerUserId: null });
    // AI SDK signature: needsApproval(input, { toolCallId, messages, experimental_context }).
    // 单测只关心返回值; 给最小的 options 形参。
    const need = await (built.spec as any).needsApproval(validDraft, {
      toolCallId: "tc-1",
      messages: [],
    });
    expect(need).toBe(false);
  });

  it("signed-in → needsApproval returns true (AI SDK pauses for HITL)", async () => {
    const built = buildCreateStudyDraftTool({ ownerUserId: "u1" });
    const need = await (built.spec as any).needsApproval(validDraft, {
      toolCallId: "tc-1",
      messages: [],
    });
    expect(need).toBe(true);
  });

  it("buildAssistantTools 暴露的 spec 也带 needsApproval (扁平 record 透传不丢)", async () => {
    const tools = buildAssistantTools({ ownerUserId: "u1" });
    const need = await (tools.createStudyDraft as any).needsApproval(validDraft, {
      toolCallId: "tc-1",
      messages: [],
    });
    expect(need).toBe(true);
  });
});

// --- P-MORRIS-CSD: anonymous 预览对任意合法 SurveyDraft 无损回显 ---

/** 只生成无需 options 的题型,使生成的 draft 总是通过 SurveyDraftSchema.superRefine。 */
// trim 不变量生效后, 纯空白串会被拒,生成器用 trim 后非空的文本。
const nonBlank = fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0);
const safeQuestionArb = fc.record({
  questionText: nonBlank,
  questionType: fc.constantFrom("open_ended", "rating", "nps"),
});
const sectionArb = fc.record({
  title: nonBlank,
  objective: nonBlank,
  questions: fc.array(safeQuestionArb, { minLength: 1, maxLength: 4 }),
});
const draftArb = fc.record({
  title: nonBlank,
  researchGoal: nonBlank,
  targetAudience: nonBlank,
  introScript: nonBlank,
  sections: fc.array(sectionArb, { minLength: 1, maxLength: 4 }),
});

describe("P-MORRIS-CSD: anonymous preview echoes the parsed draft losslessly", () => {
  it("for any valid draft, preview artifact.draft === SurveyDraftSchema.parse(input)", async () => {
    const built = buildCreateStudyDraftTool({ ownerUserId: null });
    await fc.assert(
      fc.asyncProperty(draftArb, async (raw) => {
        const res = await (built.spec as any).execute(raw);
        expect(res.artifact.persisted).toBe(false);
        // 无损: 工具回显的 draft 与「契约 parse 后」的 draft 完全一致(含默认值补全)。
        expect(res.artifact.draft).toEqual(SurveyDraftSchema.parse(raw));
        const questionCount = raw.sections.reduce((n: number, s) => n + s.questions.length, 0);
        expect(res.content).toContain(`${questionCount} 个问题`);
      }),
      { numRuns: 50 },
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
