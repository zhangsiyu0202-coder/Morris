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
vi.mock("node-appwrite", async () => (await import("./fixtures/install-mocks")).fakeNodeAppwriteModule());

import { createSurveyFromDraft } from "@/lib/actions/survey";
import { buildCreateStudyDraftTool } from "../tools/create-study-draft";
import { buildAssistantTools } from "../tools";

const mockCreate = vi.mocked(createSurveyFromDraft);

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
});

describe("createStudyDraft: auth-conditional behavior", () => {
  it("anonymous (ownerUserId null) → preview only, never writes", async () => {
    const built = buildCreateStudyDraftTool({ ownerUserId: null });
    const res = await (built.spec as any).execute(
      validDraft,
    );
    expect(res.artifact).toMatchObject({ persisted: false });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("signed-in + approvalToken → persists via createSurveyFromDraft", async () => {
    mockCreate.mockResolvedValue({ surveyId: "sv9", url: "/studies/sv9" });
    const built = buildCreateStudyDraftTool({ ownerUserId: "u1" });
    const res = await (built.spec as any).execute(
      { ...validDraft, approvalToken: "tok-1" },
    );
    expect(mockCreate).toHaveBeenCalledOnce();
    expect(res.artifact).toMatchObject({ persisted: true, surveyId: "sv9", url: "/studies/sv9" });
  });

  it("invalid draft (choice question without options) → tool error, no write", async () => {
    const built = buildCreateStudyDraftTool({ ownerUserId: "u1" });
    const bad = {
      ...validDraft,
      approvalToken: "tok-1",
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

describe("createStudyDraft: approval guard wiring", () => {
  it("signed-in, no approvalToken → pending_approval (guard intercepts, no write)", async () => {
    const tools = buildAssistantTools({ ownerUserId: "u1" });
    const res = (await (tools.createStudyDraft as any).execute(
      validDraft,
    )) as { artifact: Record<string, unknown> };
    expect(res.artifact).toMatchObject({ status: "pending_approval", toolName: "createStudyDraft" });
    // approval 卡片需要 payload 原样带回 confirm 端点。
    expect(res.artifact.payload).toMatchObject({ title: validDraft.title });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("anonymous, no approvalToken → preview (guard is identity, executes)", async () => {
    const tools = buildAssistantTools({ ownerUserId: null });
    const res = (await (tools.createStudyDraft as any).execute(
      validDraft,
    )) as { artifact: Record<string, unknown> };
    expect(res.artifact).toMatchObject({ persisted: false });
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
