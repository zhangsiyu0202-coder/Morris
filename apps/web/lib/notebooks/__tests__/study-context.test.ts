import { describe, it, expect, vi, beforeEach } from "vitest";

// buildStudyContext depends on the queries barrel (Appwrite reads). Mock it so
// the test exercises only the ADR-0015 research-intent composition, not I/O.
const getStudy = vi.fn();
const getLatestAnalysisReport = vi.fn();
const searchTranscriptSegments = vi.fn();
const parseSurveyReportBody = vi.fn();
const countCompletedSessions = vi.fn();
const listStudies = vi.fn();

vi.mock("@/lib/queries", () => ({
  getStudy,
  getLatestAnalysisReport,
  searchTranscriptSegments,
  parseSurveyReportBody,
  countCompletedSessions,
  listStudies,
}));

const { buildStudyContext } = await import("../study-context");

function surveyWith(fields: {
  instruction?: string;
  flowConfig?: Record<string, unknown>;
}) {
  return {
    survey: {
      $id: "sv1",
      projectId: "p1",
      title: "差旅住宿调研",
      status: "published",
      flowConfig: fields.flowConfig ?? {},
      instruction: fields.instruction ?? "",
      version: 1,
      updatedAt: new Date().toISOString(),
    },
    sections: [],
    questions: [],
  };
}

describe("buildStudyContext — research-intent backdrop (ADR-0015 Wave 4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getLatestAnalysisReport.mockResolvedValue(null);
    searchTranscriptSegments.mockResolvedValue([]);
  });

  it("includes Survey.instruction verbatim when present", async () => {
    const instruction = "## 研究意图\n了解差旅用户的预订决策";
    getStudy.mockResolvedValue(surveyWith({ instruction }));
    const ctx = await buildStudyContext("owner", "sv1");
    expect(ctx).toContain("研究说明");
    expect(ctx).toContain("了解差旅用户的预订决策");
  });

  it("does not synthesize research context when instruction is empty", async () => {
    getStudy.mockResolvedValue(surveyWith({ instruction: "" }));
    const ctx = await buildStudyContext("owner", "sv1");
    expect(ctx).not.toContain("研究说明");
  });

  it("omits the backdrop entirely when no instruction and no legacy fields", async () => {
    getStudy.mockResolvedValue(surveyWith({}));
    const ctx = await buildStudyContext("owner", "sv1");
    expect(ctx).not.toContain("研究说明");
    expect(ctx).toContain("调研标题:差旅住宿调研");
  });
});
