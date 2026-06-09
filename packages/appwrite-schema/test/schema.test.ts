import { describe, it, expect } from "vitest";
import { COLLECTIONS, BUCKETS } from "../src/schema.js";

const FORBIDDEN = /team|share|comment|billing|subscribe|quota|plan|seat|usage[-_]?meter/i;

describe("appwrite schema declaration", () => {
  it("declares all 15 collections (researcher identity is Appwrite Account, no users collection)", () => {
    const ids = COLLECTIONS.map((c) => c.id).sort();
    expect(ids).not.toContain("users");
    expect(ids).toEqual(
      [
        "analysis_reports",
        "bookmarks",
        "dashboard_tiles",
        "dashboard_widgets",
        "dashboards",
        "insights",
        "interview_links",
        "interview_sessions",
        "notebooks",
        "projects",
        "question_blocks",
        "recordings",
        "surveys",
        "survey_sections",
        "transcripts",
      ].sort(),
    );
  });

  it("enables document security on every collection", () => {
    for (const c of COLLECTIONS) expect(c.documentSecurity).toBe(true);
  });

  it("interview_links exposes no client permissions (server-only)", () => {
    const link = COLLECTIONS.find((c) => c.id === "interview_links")!;
    expect(link.permissions).toEqual([]);
  });

  it("interview_links carries a kind attribute (production|test) defaulting to production", () => {
    const link = COLLECTIONS.find((c) => c.id === "interview_links")!;
    const kind = link.attributes.find((a) => a.key === "kind")!;
    expect(kind).toBeDefined();
    expect(kind.type).toBe("enum");
    expect(kind.elements).toEqual(["production", "test"]);
    expect(kind.required).toBe(false);
    expect(kind.default).toBe("production");
  });

  it("server-write collections grant no client create", () => {
    for (const id of ["interview_sessions", "transcripts", "recordings"]) {
      expect(COLLECTIONS.find((c) => c.id === id)!.permissions).toEqual([]);
    }
  });

  it("declares the three storage buckets", () => {
    expect(BUCKETS.map((b) => b.id).sort()).toEqual(["recordings", "reports", "survey-assets"]);
  });

  it("contains no out-of-scope field names (Req 9.2)", () => {
    for (const c of COLLECTIONS) {
      for (const a of c.attributes) {
        expect(a.key, `${c.id}.${a.key}`).not.toMatch(FORBIDDEN);
      }
    }
  });

  it("surveys.status enum includes closed between paused and archived", () => {
    const surveys = COLLECTIONS.find((c) => c.id === "surveys")!;
    const status = surveys.attributes.find((a) => a.key === "status")!;
    expect(status.elements).toEqual(["draft", "published", "paused", "closed", "archived"]);
  });

  it("models sections and section-scoped question ordering", () => {
    const sections = COLLECTIONS.find((c) => c.id === "survey_sections")!;
    const questions = COLLECTIONS.find((c) => c.id === "question_blocks")!;

    expect(sections.attributes.map((a) => a.key)).toContain("sectionInstruction");
    expect(questions.attributes.map((a) => a.key)).toContain("sectionId");
    expect(questions.attributes.map((a) => a.key)).toContain("orderInSection");
    expect(questions.indexes.some((idx) => idx.key === "section_order_unique")).toBe(true);
  });
});

describe("appwrite schema: analysis-report sub-spec (T2)", () => {
  it("AnalysisReport.sessionId is optional and ownerUserId is required", () => {
    const ar = COLLECTIONS.find((c) => c.id === "analysis_reports")!;
    const sessionId = ar.attributes.find((a) => a.key === "sessionId")!;
    const ownerUserId = ar.attributes.find((a) => a.key === "ownerUserId")!;
    expect(sessionId.required).toBe(false);
    expect(ownerUserId.required).toBe(true);
  });

  it("AnalysisReport carries the indexes the analyze Functions need", () => {
    const ar = COLLECTIONS.find((c) => c.id === "analysis_reports")!;
    const idxKeys = ar.indexes.map((i) => i.key);
    for (const expected of ["by_session", "by_survey", "by_scope_session", "by_scope_survey", "by_owner"]) {
      expect(idxKeys, `missing index ${expected}`).toContain(expected);
    }
  });

  it("Insight collection is owner-scoped with the expected attributes", () => {
    const ins = COLLECTIONS.find((c) => c.id === "insights")!;
    expect(ins.permissions).toContain('create("users")');
    expect(ins.documentSecurity).toBe(true);
    const keys = ins.attributes.map((a) => a.key).sort();
    expect(keys).toEqual(
      [
        "confidence",
        "createdAt",
        "headline",
        "ownerUserId",
        "question",
        "report",
        "sampleSize",
        "studyId",
        "studyTitle",
        "summary",
      ].sort(),
    );
    const confidence = ins.attributes.find((a) => a.key === "confidence")!;
    expect(confidence.type).toBe("enum");
    expect(confidence.elements).toEqual(["high", "medium", "low"]);
  });

  it("Recording collection carries ownerUserId and video formats", () => {
    const rec = COLLECTIONS.find((c) => c.id === "recordings")!;
    expect(rec.attributes.map((a) => a.key)).toContain("ownerUserId");
    const format = rec.attributes.find((a) => a.key === "format")!;
    expect(format.elements).toEqual(["mp3", "opus", "wav", "mp4", "webm"]);
  });

  it("Bookmark collection is owner-scoped with expected attributes", () => {
    const bm = COLLECTIONS.find((c) => c.id === "bookmarks")!;
    expect(bm.permissions).toContain('create("users")');
    expect(bm.documentSecurity).toBe(true);
    const keys = bm.attributes.map((a) => a.key).sort();
    expect(keys).toEqual(
      [
        "createdAt",
        "ownerUserId",
        "quote",
        "respondent",
        "segmentIndex",
        "sessionId",
        "source",
        "surveyId",
      ].sort(),
    );
    expect(bm.indexes.map((i) => i.key)).toContain("by_owner_created");
  });

  it("Dashboard collections model study-scoped widget tiles", () => {
    const dashboard = COLLECTIONS.find((c) => c.id === "dashboards")!;
    const widget = COLLECTIONS.find((c) => c.id === "dashboard_widgets")!;
    const tile = COLLECTIONS.find((c) => c.id === "dashboard_tiles")!;

    expect(dashboard.permissions).toContain('create("users")');
    expect(widget.permissions).toContain('create("users")');
    expect(tile.permissions).toContain('create("users")');
    expect(dashboard.attributes.find((a) => a.key === "scope")?.elements).toEqual(["study"]);
    expect(widget.attributes.find((a) => a.key === "widgetType")?.elements).toContain("visual_moments");
    expect(tile.attributes.map((a) => a.key)).toContain("layout");
    expect(tile.indexes.map((i) => i.key)).toContain("by_dashboard_order");
  });

  it("recordings bucket allows video extensions", () => {
    const bucket = BUCKETS.find((b) => b.id === "recordings")!;
    expect(bucket?.allowedFileExtensions).toEqual(["mp4", "webm", "mp3", "opus", "wav"]);
  });
});
