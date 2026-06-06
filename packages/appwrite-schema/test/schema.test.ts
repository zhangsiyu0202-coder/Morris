import { describe, it, expect } from "vitest";
import { COLLECTIONS, BUCKETS } from "../src/schema.js";

const FORBIDDEN = /team|share|comment|billing|subscribe|quota|plan|seat|usage[-_]?meter/i;

describe("appwrite schema declaration", () => {
  it("declares all 11 collections", () => {
    const ids = COLLECTIONS.map((c) => c.id).sort();
    expect(ids).toEqual(
      [
        "analysis_reports",
        "insights",
        "interview_links",
        "interview_sessions",
        "projects",
        "question_blocks",
        "recordings",
        "surveys",
        "survey_sections",
        "transcripts",
        "users",
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

  it("Insight collection indexes by owner and by owner+study", () => {
    const ins = COLLECTIONS.find((c) => c.id === "insights")!;
    const idxKeys = ins.indexes.map((i) => i.key);
    expect(idxKeys).toContain("by_owner");
    expect(idxKeys).toContain("by_owner_study");
    expect(idxKeys).toContain("by_owner_created");
  });
});
