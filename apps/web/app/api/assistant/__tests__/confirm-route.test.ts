import { describe, it, expect, vi } from "vitest";

// confirm 路由 import @/lib/actions/survey::createSurveyFromDraft (server-only, node-appwrite)。
// 单文件 mock 该写动作即可隔离;不拉整个 tools 链。
vi.mock("@/lib/actions/survey", () => ({
  createSurveyFromDraft: vi.fn(),
}));

import { createSurveyFromDraft } from "@/lib/actions/survey";
import { POST } from "@/app/api/assistant/confirm/route";

const mockCreate = vi.mocked(createSurveyFromDraft);

function req(body: unknown): Request {
  return new Request("http://localhost/api/assistant/confirm", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const validDraft = {
  title: "差旅住宿",
  researchGoal: "了解差旅住宿预订",
  targetAudience: "出差党",
  introScript: "你好,感谢参与。",
  sections: [
    { title: "渠道", objective: "了解渠道", questions: [{ questionText: "怎么订?", questionType: "open_ended" }] },
  ],
};

// NB: 不在 beforeEach 里碰 mockCreate —— vitest 在 "hook 触碰 mock + 该 mock 同步 throw"
// 组合下会把被路由 catch 掉的错误误报成测试失败。改为每个用例体内自行 reset。
describe("POST /api/assistant/confirm", () => {
  it("approve + createStudyDraft + valid payload → 200, persists, returns surveyId/url", async () => {
    mockCreate.mockReset();
    mockCreate.mockResolvedValue({ surveyId: "sv1", url: "/studies/sv1" });
    const res = await POST(req({ proposalId: "p1", decision: "approve", toolName: "createStudyDraft", payload: validDraft }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, surveyId: "sv1", url: "/studies/sv1" });
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it("reject → 200, no write", async () => {
    mockCreate.mockReset();
    const res = await POST(req({ proposalId: "p1", decision: "reject", toolName: "createStudyDraft", feedback: "改一下" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, decision: "reject" });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("approve + createStudyDraft + invalid payload → 400, no write", async () => {
    mockCreate.mockReset();
    const res = await POST(req({ proposalId: "p1", decision: "approve", toolName: "createStudyDraft", payload: { title: "x" } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_input");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("approve + unknown toolName → 501", async () => {
    mockCreate.mockReset();
    const res = await POST(req({ proposalId: "p1", decision: "approve", toolName: "somethingElse", payload: {} }));
    expect(res.status).toBe(501);
    expect((await res.json()).error).toBe("not_implemented_yet");
  });

  it("not_authenticated from write action → 401", async () => {
    mockCreate.mockReset();
    mockCreate.mockImplementation(() => {
      throw new Error("not_authenticated");
    });
    const res = await POST(req({ proposalId: "p1", decision: "approve", toolName: "createStudyDraft", payload: validDraft }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("not_authenticated");
  });

  it("malformed JSON body → 400", async () => {
    mockCreate.mockReset();
    const res = await POST(req("not json{"));
    expect(res.status).toBe(400);
  });

  it("schema-invalid envelope (bad decision) → 400", async () => {
    mockCreate.mockReset();
    const res = await POST(req({ proposalId: "p1", decision: "maybe" }));
    expect(res.status).toBe(400);
  });
});
