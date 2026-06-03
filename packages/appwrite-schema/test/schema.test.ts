import { describe, it, expect } from "vitest";
import { COLLECTIONS, BUCKETS } from "../src/schema.js";

const FORBIDDEN = /team|share|comment|billing|subscribe|quota|plan|seat|usage[-_]?meter/i;

describe("appwrite schema declaration", () => {
  it("declares all 10 collections", () => {
    const ids = COLLECTIONS.map((c) => c.id).sort();
    expect(ids).toEqual(
      [
        "analysis_reports",
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
