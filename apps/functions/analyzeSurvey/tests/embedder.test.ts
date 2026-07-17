import { describe, expect, it, vi } from "vitest";

import {
  createAiHubMixJinaEmbedder,
  JINA_EMBEDDING_DIMENSIONS,
  JINA_EMBEDDING_MODEL,
} from "../src/embedder.js";

const vector = Array.from({ length: JINA_EMBEDDING_DIMENSIONS }, (_, index) => index / 1024);

describe("survey evidence embedding adapter", () => {
  it("uses Jina retrieval task modes and validates the 1024-dimensional vector", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ index: 0, embedding: vector }] }), { status: 200 }),
    );
    const embed = createAiHubMixJinaEmbedder({ apiKey: "test-key", fetchFn });

    await expect(embed({ text: "Why did the participant abandon checkout?", task: "retrieval.query" })).resolves.toEqual(vector);

    expect(fetchFn).toHaveBeenCalledWith(
      "https://api.inferera.com/v1/embeddings",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer test-key",
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          model: JINA_EMBEDDING_MODEL,
          input: ["Why did the participant abandon checkout?"],
          task: "retrieval.query",
          dimensions: JINA_EMBEDDING_DIMENSIONS,
          encoding_format: "float",
        }),
      }),
    );
  });

  it("rejects malformed, wrong-sized, or non-finite provider vectors", async () => {
    const wrongSize = createAiHubMixJinaEmbedder({
      apiKey: "test-key",
      fetchFn: vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: [{ index: 0, embedding: [0, 1] }] }), { status: 200 }),
      ),
    });
    const nonFinite = createAiHubMixJinaEmbedder({
      apiKey: "test-key",
      fetchFn: vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: [{ index: 0, embedding: Array.from({ length: JINA_EMBEDDING_DIMENSIONS }, () => null) }] }), { status: 200 }),
      ),
    });

    await expect(wrongSize({ text: "evidence", task: "retrieval.passage" })).rejects.toThrow(/embedding response malformed/);
    await expect(nonFinite({ text: "evidence", task: "retrieval.passage" })).rejects.toThrow(/embedding response malformed/);
  });

  it("retries transient provider errors without exposing a provider response body", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: "private upstream diagnostic" }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ index: 0, embedding: vector }] }), { status: 200 }));
    const embed = createAiHubMixJinaEmbedder({ apiKey: "test-key", fetchFn });

    await expect(embed({ text: "evidence", task: "retrieval.passage" })).resolves.toEqual(vector);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
