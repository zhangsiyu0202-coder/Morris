import { describe, expect, it, vi } from "vitest";

import { createAiHubMixReranker } from "../src/reranker.js";
import type { RerankCandidateRecord } from "../src/rerank.js";

const candidates: RerankCandidateRecord[] = [
  { finding: { kind: "theme", sourceId: "theme-pricing" }, document: "kind: theme\nlabel: Hidden fees" },
  { finding: { kind: "insight", sourceId: "insight-trust" }, document: "kind: insight\ntitle: Trust falls" },
];

describe("survey reranker adapter", () => {
  it("uses the documented rerank request and maps provider indexes to report findings", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            { index: 1, relevance_score: 0.92 },
            { index: 0, relevance_score: 0.72 },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const rerank = createAiHubMixReranker({
      apiKey: "test-key",
      fetchFn,
    });

    await expect(
      rerank({ query: "Prioritize decision-relevant checkout findings.", candidates }),
    ).resolves.toEqual([
      { kind: "insight", sourceId: "insight-trust", rank: 1, relevanceScore: 0.92 },
      { kind: "theme", sourceId: "theme-pricing", rank: 2, relevanceScore: 0.72 },
    ]);

    expect(fetchFn).toHaveBeenCalledWith(
      "https://api.inferera.com/v1/rerank",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer test-key",
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          model: "cohere-rerank-v4.0-fast",
          query: "Prioritize decision-relevant checkout findings.",
          top_n: 2,
          documents: candidates.map((candidate) => candidate.document),
          return_documents: false,
        }),
      }),
    );
  });

  it("does not expose provider response bodies when the request fails", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "upstream diagnostic" }), { status: 503 }),
    );
    const rerank = createAiHubMixReranker({
      apiKey: "test-key",
      fetchFn,
    });

    let error: Error | undefined;
    try {
      await rerank({ query: "q", candidates });
    } catch (reason) {
      error = reason as Error;
    }
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toContain("rerank request failed: 503");
    expect(error?.message).not.toContain("upstream diagnostic");
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("retries a transient rate limit and persists only the successful complete ranking", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 429 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ results: [{ index: 0, relevance_score: 0.8 }, { index: 1, relevance_score: 0.7 }] }), {
          status: 200,
        }),
      );
    const rerank = createAiHubMixReranker({ apiKey: "test-key", fetchFn });

    await expect(rerank({ query: "q", candidates })).resolves.toHaveLength(2);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("falls back to a configured DNS resolver when Docker lookup returns EAI_AGAIN", async () => {
    const dnsFallbackFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ results: [{ index: 0, relevance_score: 0.8 }, { index: 1, relevance_score: 0.7 }] }),
        { status: 200 },
      ),
    );
    const dnsError = Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error("getaddrinfo EAI_AGAIN api.inferera.com"), { code: "EAI_AGAIN" }),
    });
    const rerank = createAiHubMixReranker({
      apiKey: "test-key",
      fetchFn: vi.fn().mockRejectedValue(dnsError),
      dnsFallbackFetch,
    });

    await expect(rerank({ query: "q", candidates })).resolves.toHaveLength(2);
    expect(dnsFallbackFetch).toHaveBeenCalledWith(
      "https://api.inferera.com/v1/rerank",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("rejects malformed provider results before they reach report persistence", async () => {
    const rerank = createAiHubMixReranker({
      apiKey: "test-key",
      fetchFn: vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ results: [{ index: 8, relevance_score: 0.9 }] }), { status: 200 }),
      ),
    });

    await expect(rerank({ query: "q", candidates })).rejects.toThrow(/complete|index/);
  });
});
