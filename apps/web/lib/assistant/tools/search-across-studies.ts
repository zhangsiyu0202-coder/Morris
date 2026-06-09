import { tool } from "ai";
import { z } from "zod";
import { Client, Databases, Query } from "node-appwrite";

import {
  NOT_SIGNED_IN,
  toToolError,
  toolResult,
  type ToolErrorArtifact,
  type ToolResultEnvelope,
} from "../envelope";
import type { AssistantToolContext } from "../tool-types";
import { embedText, EMBEDDING_DIM } from "@/lib/server/embedder-qwen";

/**
 * `searchAcrossStudies` Morris 工具 (Wave E, R5).
 *
 * 跨 study 在当前研究员的 Notebook 集合中做语义检索 (Qwen text-embedding-v3
 * 1024-dim cosine similarity). 返回 top-N 匹配, owner 级隔离 (永不跨 owner)。
 *
 * MIRRORS apps/functions/searchAcrossNotebooks/src/handler.ts (B4 修订决策:
 * 第一版复制粘贴, 多 Function 时再抽到共享包). web 端这个工具是为 Morris
 * 提供的同步入口; 单独 Function 是为 cron / 外部调用预留的。
 *
 * 触发条件: 研究员问 "我之前研究过类似 X 吗" / "上次 pricing 结论是什么"
 * 等场景。
 *
 * 性能 (review S1 #4): owner-scoped notebook 数超过 EMBEDDING_BRUTEFORCE_LIMIT=100
 * 时自动 fallback 为 Appwrite fulltext, 避免 brute-force IO 延迟超 1 秒。
 */

const NOTEBOOKS = "notebooks";
const DATABASE_ID = process.env.APPWRITE_DATABASE_ID ?? "merism";
const EMBEDDING_BRUTEFORCE_LIMIT = 100;

interface NotebookRow {
  shortId: string;
  studyId: string;
  studyTitle: string;
  headline: string;
  textContent: string;
  embedding: number[] | null;
}

interface Match {
  notebookShortId: string;
  studyId: string;
  studyTitle: string;
  headline: string;
  snippet: string;
  score: number;
}

interface Artifact {
  matches: Match[];
  fallback?: "scale-fulltext-only" | "embedding-error";
}

function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function makeSnippet(textContent: string, query: string, max = 200): string {
  if (!textContent) return "";
  const idx = textContent.toLowerCase().indexOf(query.toLowerCase().slice(0, 20));
  if (idx === -1) return textContent.slice(0, max).trim();
  const start = Math.max(0, idx - 60);
  return textContent.slice(start, start + max).trim();
}

function getDb(): Databases {
  const endpoint = process.env.APPWRITE_ENDPOINT;
  const projectId = process.env.APPWRITE_PROJECT_ID;
  const apiKey = process.env.APPWRITE_API_KEY;
  if (!endpoint || !projectId || !apiKey) {
    throw new Error("appwrite_not_configured");
  }
  const client = new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey);
  return new Databases(client);
}

async function loadOwnerNotebooks(
  db: Databases,
  ownerUserId: string,
  studyIdFilter: string | null,
): Promise<NotebookRow[]> {
  const queries = [
    Query.equal("ownerUserId", ownerUserId),
    Query.select([
      "$id",
      "shortId",
      "studyId",
      "studyTitle",
      "headline",
      "textContent",
      "embedding",
    ]),
    Query.limit(200),
  ];
  if (studyIdFilter) queries.push(Query.equal("studyId", studyIdFilter));
  const result = await db.listDocuments(DATABASE_ID, NOTEBOOKS, queries);
  const rows: NotebookRow[] = [];
  for (const raw of result.documents) {
    const r = raw as unknown as {
      shortId: string;
      studyId: string;
      studyTitle: string;
      headline: string;
      textContent: string;
      embedding: string;
    };
    let vec: number[] | null = null;
    if (r.embedding) {
      try {
        const parsed = JSON.parse(r.embedding);
        if (Array.isArray(parsed) && parsed.length === EMBEDDING_DIM) {
          vec = parsed as number[];
        }
      } catch {
        /* skip — leave vec null */
      }
    }
    rows.push({
      shortId: r.shortId,
      studyId: r.studyId,
      studyTitle: r.studyTitle,
      headline: r.headline,
      textContent: r.textContent,
      embedding: vec,
    });
  }
  return rows;
}

async function fulltextFallback(
  db: Databases,
  query: string,
  ownerUserId: string,
  studyIdFilter: string | null,
  limit: number,
): Promise<Match[]> {
  const queries = [
    Query.equal("ownerUserId", ownerUserId),
    Query.search("textContent", query),
    Query.select(["shortId", "studyId", "studyTitle", "headline", "textContent"]),
    Query.limit(limit),
  ];
  if (studyIdFilter) queries.push(Query.equal("studyId", studyIdFilter));
  const result = await db.listDocuments(DATABASE_ID, NOTEBOOKS, queries);
  return result.documents.map((raw) => {
    const r = raw as unknown as {
      shortId: string;
      studyId: string;
      studyTitle: string;
      headline: string;
      textContent: string;
    };
    return {
      notebookShortId: r.shortId,
      studyId: r.studyId,
      studyTitle: r.studyTitle,
      headline: r.headline,
      snippet: makeSnippet(r.textContent, query),
      score: 0,
    };
  });
}

export function buildSearchAcrossStudiesTool(ctx: AssistantToolContext) {
  const { ownerUserId } = ctx;
  return {
    contextPromptTemplate: undefined as string | undefined,
    spec: tool({
      description:
        "在当前研究员所有 Notebook (跨 study) 中按语义检索相似的过往洞察。" +
        "用于跨 study 引用 — 研究员问 '我之前研究过类似 X 吗' / '上次的 pricing 结论' 等。" +
        "返回 top-N 匹配, 每条含 notebookShortId / headline / snippet / score。" +
        "owner 级隔离 (永不跨 owner)。Notebook 数量过多或 embedding API 不可用时" +
        "自动退化为 fulltext 检索 (response.fallback 字段标记)。",
      inputSchema: z.object({
        query: z
          .string()
          .min(1)
          .max(500)
          .describe("自然语言检索 query"),
        studyId: z
          .string()
          .nullable()
          .describe("可选: 限定到某 study; null 表示跨所有 study"),
        limit: z.number().int().min(1).max(20).describe("返回的 top-N 上限 (1-20)"),
      }),
      execute: async ({
        query,
        studyId,
        limit,
      }): Promise<ToolResultEnvelope<Artifact | ToolErrorArtifact>> => {
        if (!ownerUserId) return NOT_SIGNED_IN;
        try {
          const db = getDb();
          const studyIdFilter = studyId ?? null;
          const rows = await loadOwnerNotebooks(db, ownerUserId, studyIdFilter);

          // Decide brute-force vs fulltext fallback.
          if (rows.length > EMBEDDING_BRUTEFORCE_LIMIT) {
            const matches = await fulltextFallback(
              db,
              query,
              ownerUserId,
              studyIdFilter,
              limit,
            );
            return toolResult(
              `检索到 ${matches.length} 条相关 Notebook (退化为 fulltext: 数据规模超过阈值)。`,
              { matches, fallback: "scale-fulltext-only" as const },
            );
          }

          // Try embedding the query.
          let queryVec: number[];
          try {
            queryVec = await embedText(query);
          } catch {
            const matches = await fulltextFallback(
              db,
              query,
              ownerUserId,
              studyIdFilter,
              limit,
            );
            return toolResult(
              `检索到 ${matches.length} 条相关 Notebook (退化为 fulltext: embedding 不可用)。`,
              { matches, fallback: "embedding-error" as const },
            );
          }

          // Brute-force cosine, ignore rows missing embedding (Wave A/B fallback).
          const scored = rows
            .filter((r) => r.embedding !== null)
            .map((r) => ({ r, score: cosine(queryVec, r.embedding as number[]) }))
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);

          const matches: Match[] = scored.map(({ r, score }) => ({
            notebookShortId: r.shortId,
            studyId: r.studyId,
            studyTitle: r.studyTitle,
            headline: r.headline,
            snippet: makeSnippet(r.textContent, query),
            score,
          }));

          return toolResult(
            `检索到 ${matches.length} 条相关 Notebook。`,
            { matches } satisfies Artifact,
          );
        } catch (err) {
          return toToolError("跨 study 检索", err);
        }
      },
    }),
  };
}
