import { describe, it, expect, vi } from "vitest";
import {
  searchAcrossNotebooks,
  EMBEDDING_BRUTEFORCE_LIMIT,
} from "../src/handler";
import type {
  NotebookEmbeddingRow,
  FulltextHit,
  SearchAcrossNotebooksDeps,
} from "../src/deps";

function makeRow(
  i: number,
  vec: number[],
  studyId = "sv1",
): NotebookEmbeddingRow {
  return {
    $id: `doc${i}`,
    shortId: `short${String(i).padStart(7, "0")}`,
    studyId,
    studyTitle: `Study ${studyId}`,
    headline: `Headline ${i}`,
    textContent: `Body ${i}: pricing analysis text`,
    embedding: vec,
  };
}

function makeDeps(rows: NotebookEmbeddingRow[], queryVec: number[] = [1, 0, 0, 0]): SearchAcrossNotebooksDeps {
  return {
    embedQuery: vi.fn().mockResolvedValue(queryVec),
    loadNotebooksWithEmbedding: vi.fn().mockResolvedValue(rows),
    searchNotebooksFulltext: vi.fn().mockResolvedValue(
      rows.map((r) => ({
        $id: r.$id,
        shortId: r.shortId,
        studyId: r.studyId,
        studyTitle: r.studyTitle,
        headline: r.headline,
        textContent: r.textContent,
      })) as FulltextHit[],
    ),
  };
}

describe("searchAcrossNotebooks pure core", () => {
  it("400 on invalid input", async () => {
    const deps = makeDeps([]);
    const result = await searchAcrossNotebooks(
      { query: "", ownerUserId: "u1" },
      deps,
    );
    expect(result.status).toBe(400);
  });

  it("brute-force cosine: returns top-N sorted desc", async () => {
    const rows = [
      makeRow(1, [1, 0, 0, 0]), // identical → score=1
      makeRow(2, [0, 1, 0, 0]), // orthogonal → score=0
      makeRow(3, [-1, 0, 0, 0]), // antiparallel → score=-1
      makeRow(4, [0.9, 0.1, 0, 0]), // close → score~0.99
    ];
    const deps = makeDeps(rows, [1, 0, 0, 0]);
    const result = await searchAcrossNotebooks(
      { query: "pricing", ownerUserId: "u1", limit: 3 },
      deps,
    );
    expect(result.status).toBe(200);
    if (result.status !== 200) return;
    expect(result.body.matches).toHaveLength(3);
    expect(result.body.matches[0]?.notebookShortId).toBe("short0000001");
    expect(result.body.matches[0]?.score).toBeCloseTo(1, 5);
    expect(result.body.matches[1]?.score).toBeCloseTo(0.9939, 3);
    expect(result.body.matches[2]?.score).toBe(0);
    expect(result.body.fallback).toBeUndefined();
  });

  it("studyId filter forwards to deps.loadNotebooksWithEmbedding", async () => {
    const rows = [makeRow(1, [1, 0, 0, 0], "sv1"), makeRow(2, [1, 0, 0, 0], "sv2")];
    const deps = makeDeps(rows);
    await searchAcrossNotebooks(
      { query: "x", ownerUserId: "u1", studyId: "sv1", limit: 5 },
      deps,
    );
    expect(deps.loadNotebooksWithEmbedding).toHaveBeenCalledWith("u1", "sv1");
  });

  it("ownerUserId is always forwarded (never leaks across owners)", async () => {
    const deps = makeDeps([makeRow(1, [1, 0, 0, 0])]);
    await searchAcrossNotebooks(
      { query: "x", ownerUserId: "alice", limit: 5 },
      deps,
    );
    expect(deps.loadNotebooksWithEmbedding).toHaveBeenCalledWith("alice", null);
  });

  it("fallback to fulltext when row count > EMBEDDING_BRUTEFORCE_LIMIT", async () => {
    const manyRows = Array.from({ length: EMBEDDING_BRUTEFORCE_LIMIT + 1 }, (_, i) =>
      makeRow(i, [1, 0, 0, 0]),
    );
    const deps = makeDeps(manyRows);
    const result = await searchAcrossNotebooks(
      { query: "x", ownerUserId: "u1", limit: 5 },
      deps,
    );
    expect(result.status).toBe(200);
    if (result.status !== 200) return;
    expect(result.body.fallback).toBe("scale-fulltext-only");
    expect(deps.embedQuery).not.toHaveBeenCalled();
    expect(deps.searchNotebooksFulltext).toHaveBeenCalled();
  });

  it("fallback to fulltext when embedQuery throws (Qwen API error)", async () => {
    const rows = [makeRow(1, [1, 0, 0, 0])];
    const deps: SearchAcrossNotebooksDeps = {
      embedQuery: vi.fn().mockRejectedValue(new Error("DASHSCOPE_API_KEY not set")),
      loadNotebooksWithEmbedding: vi.fn().mockResolvedValue(rows),
      searchNotebooksFulltext: vi.fn().mockResolvedValue([
        {
          $id: "doc1",
          shortId: "short0000001",
          studyId: "sv1",
          studyTitle: "Study sv1",
          headline: "Headline 1",
          textContent: "Body 1",
        },
      ]),
    };
    const result = await searchAcrossNotebooks(
      { query: "x", ownerUserId: "u1", limit: 5 },
      deps,
    );
    expect(result.status).toBe(200);
    if (result.status !== 200) return;
    expect(result.body.fallback).toBe("embedding-error");
    expect(result.body.matches).toHaveLength(1);
  });
});
