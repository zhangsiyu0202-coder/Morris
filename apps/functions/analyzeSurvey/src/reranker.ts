import { Resolver } from "node:dns/promises";
import { request as httpsRequest } from "node:https";

import { z } from "zod";

import {
  PermanentProviderError,
  TransientProviderError,
  withRetry,
} from "@merism/observability";

import {
  type RerankFindings,
  type RerankCandidateRecord,
  validateRerankResults,
} from "./rerank.js";

const DEFAULT_BASE_URL = "https://api.inferera.com";
const DEFAULT_MODEL = "cohere-rerank-v4.0-fast";

const AiHubMixRerankResponseSchema = z.object({
  results: z.array(
    z.object({
      index: z.number().int(),
      relevance_score: z.number(),
    }),
  ),
});

export interface CreateAiHubMixRerankerOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  fetchFn?: typeof fetch;
  /** Test seam; production uses the public-DNS fallback below. */
  dnsFallbackFetch?: typeof fetch;
}

/**
 * Maps AiHubMix's Cohere-compatible Rerank endpoint to the narrow analysis
 * dependency seam. Provider responses are parsed here, before core logic can
 * use their indexes or scores.
 */
export function createAiHubMixReranker(options: CreateAiHubMixRerankerOptions): RerankFindings {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const endpoint = `${baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`}/rerank`;
  const model = options.model ?? DEFAULT_MODEL;
  const fetchFn = options.fetchFn ?? fetch;
  const requestInit = (query: string, candidates: readonly RerankCandidateRecord[]): RequestInit => ({
    method: "POST",
    headers: {
      authorization: `Bearer ${options.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      query,
      top_n: candidates.length,
      documents: candidates.map((candidate) => candidate.document),
      return_documents: false,
    }),
    signal: AbortSignal.timeout(20_000),
  });

  return async ({ query, candidates }) => {
    if (candidates.length === 0) return [];

    const response = await withRetry(
      async () => {
        try {
          const init = requestInit(query, candidates);
          let result: Response;
          try {
            result = await fetchFn(endpoint, init);
          } catch (error) {
            if (!isDnsLookupFailure(error) || (options.fetchFn && !options.dnsFallbackFetch)) {
              throw error;
            }
            result = await (options.dnsFallbackFetch ?? fetchWithPublicDns)(endpoint, init);
          }
          if (!result.ok) {
            const message = `rerank request failed: ${result.status}`;
            if (result.status === 408 || result.status === 429 || result.status >= 500) {
              throw new TransientProviderError(message);
            }
            throw new PermanentProviderError(message);
          }
          return result;
        } catch (error) {
          if (error instanceof TransientProviderError || error instanceof PermanentProviderError) {
            throw error;
          }
          throw new TransientProviderError("rerank request failed: network");
        }
      },
      { maxAttempts: 3, baseDelayMs: 100 },
    );

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new Error("rerank response malformed");
    }
    const parsed = AiHubMixRerankResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error("rerank response malformed");
    }

    return validateRerankResults(
      candidates,
      parsed.data.results.map((result) => ({
        index: result.index,
        relevanceScore: result.relevance_score,
      })),
    );
  };
}

function isDnsLookupFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const cause = error.cause as { code?: unknown } | undefined;
  return cause?.code === "EAI_AGAIN" || cause?.code === "ENOTFOUND";
}

/**
 * Docker's embedded resolver may be unable to resolve an otherwise reachable
 * provider hostname. On that narrow failure, resolve through public DNS while
 * retaining the URL hostname for TLS SNI and certificate verification.
 */
async function fetchWithPublicDns(url: string, init: RequestInit): Promise<Response> {
  const target = new URL(url);
  if (target.protocol !== "https:") {
    throw new Error("DNS fallback requires an HTTPS endpoint");
  }

  const resolver = new Resolver();
  resolver.setServers(["1.1.1.1", "8.8.8.8"]);
  const [address] = await resolver.resolve4(target.hostname);
  if (!address) throw new Error("DNS fallback returned no IPv4 address");

  return new Promise<Response>((resolve, reject) => {
    const request = httpsRequest(
      target,
      {
        method: init.method,
        headers: init.headers as Record<string, string>,
        lookup: (_hostname, _options, callback) => callback(null, address, 4),
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          resolve(new Response(Buffer.concat(chunks), { status: response.statusCode ?? 502 }));
        });
      },
    );
    request.on("error", reject);
    request.setTimeout(20_000, () => request.destroy(new Error("rerank request timed out")));
    request.end(init.body ?? undefined);
  });
}
