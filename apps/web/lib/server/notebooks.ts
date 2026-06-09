/**
 * Server-side Notebook persistence (Wave D).
 *
 * 为 Morris `createNotebook` 工具 (apps/web/lib/assistant/tools/create-notebook.ts)
 * 与 Wave E `searchAcrossNotebooks` Function 的 saver 路径提供统一的 save 入口。
 *
 * 设计 (D10 决策): 永远 create 新 row, 不存在 update existing 路径。研究员
 * 不满意 Notebook 内容时让 Morris 重新生成一份新的 (新 shortId / 新 createdAt),
 * 旧 Notebook 仍保留在 collection 里 (研究员可在 /notebooks 列表删除多余版本)。
 *
 * Wave E 在 saveNotebookFromMarkdown 流程末尾(content 落库后)调一次
 * embedder.embedText(textContent) 生成 1024 维向量, 落 embedding +
 * embeddingModel 字段 (B1 修订: embedding 不在流式过程中重算, 仅在 stream
 * 结束时一次性生成; D10 只读 → embedding 一旦生成即不再变化, 不需要 sha256
 * 比较)。当前 Wave D 占位 — Wave E T38 接通 embedder。
 */

import { Client, Databases, ID, Permission, Role } from "node-appwrite";
import { CreateNotebookRequestSchema } from "@merism/contracts";
import type { CreateNotebookRequest } from "@merism/contracts";
import { generateShortId } from "@/lib/notebooks/short-id";
import { markdownToProseMirror } from "@/lib/notebooks/markdown-to-prose";
import { extractTextContent } from "@/lib/notebooks/prose-to-markdown";
import { extractCardSections } from "@/lib/notebooks/heading-template";
import type { ProseMirrorDoc } from "@/lib/notebooks/types";
import { embedText, EMBEDDING_MODEL_TAG } from "./embedder-qwen";

const NOTEBOOKS_COLLECTION = "notebooks";

export interface SaveNotebookArgs {
  ownerUserId: string;
  studyId: string;
  studyTitle: string;
  question: string;
  /** Markdown 字符串 (Morris createNotebook content 主路径). */
  markdown?: string;
  /** Pre-converted ProseMirror doc; only one of `markdown` / `proseMirror` is required. */
  proseMirror?: ProseMirrorDoc;
  /** AI 草稿,不流式给前端用; 落库时 isDraft=true 不影响其他字段. */
  isDraft?: boolean;
}

export interface SaveNotebookResult {
  $id: string;
  shortId: string;
  sectionCount: number;
}

function getServerKeyClient(): Databases {
  const endpoint = process.env.APPWRITE_ENDPOINT;
  const projectId = process.env.APPWRITE_PROJECT_ID;
  const apiKey = process.env.APPWRITE_API_KEY;
  if (!endpoint || !projectId || !apiKey) {
    throw new Error("appwrite_not_configured");
  }
  const client = new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey);
  return new Databases(client);
}

const DATABASE_ID = process.env.APPWRITE_DATABASE_ID ?? "merism";

/**
 * Save a Notebook from Morris-generated Markdown content. Always creates a new
 * row (D10 — no update path). Returns the new row's `$id` + 12-char `shortId`.
 *
 * Throws on Appwrite client mis-config or invalid input. Callers (the Morris
 * tool execute layer) wrap thrown errors into ToolResultEnvelope error
 * artifacts.
 */
export async function saveNotebookFromMarkdown(
  args: SaveNotebookArgs,
): Promise<SaveNotebookResult> {
  // Convert markdown → ProseMirror if not pre-converted.
  const doc: ProseMirrorDoc =
    args.proseMirror ??
    (args.markdown !== undefined ? markdownToProseMirror(args.markdown) : { type: "doc", content: [] });

  const textContent = extractTextContent(doc);

  // Best-effort headline / summary extraction from the heading template.
  // Falls back to first H1 / first paragraph plain text.
  const sections = extractCardSections(doc);
  let headline = "";
  let summary = "";
  let confidence: "high" | "medium" | "low" = "medium";
  let sectionCount = 0;
  if (sections) {
    headline = sections.question;
    sectionCount = Object.keys(sections.sections).length;
    // Use the first paragraph of intro as summary.
    const firstIntro = sections.intro.find((b) => b.type === "paragraph");
    if (firstIntro && firstIntro.type === "paragraph") {
      summary = firstIntro.content
        .filter((n): n is { type: "text"; text: string } => n.type === "text")
        .map((n) => n.text)
        .join("")
        .slice(0, 500);
    }
  } else {
    // Fallback: first H1 → headline; first paragraph → summary.
    for (const b of doc.content) {
      if (!headline && b.type === "heading" && b.attrs.level === 1) {
        headline = b.content
          .filter((n): n is { type: "text"; text: string } => n.type === "text")
          .map((n) => n.text)
          .join("");
      }
      if (!summary && b.type === "paragraph") {
        summary = b.content
          .filter((n): n is { type: "text"; text: string } => n.type === "text")
          .map((n) => n.text)
          .join("")
          .slice(0, 500);
      }
      if (headline && summary) break;
    }
    if (!headline) headline = args.question.slice(0, 200);
    sectionCount = doc.content.filter((b) => b.type === "heading" && b.attrs.level === 2).length;
  }

  if (!summary) summary = "(空摘要)";

  const db = getServerKeyClient();
  const $id = ID.unique();
  const shortId = generateShortId();
  const now = new Date().toISOString();

  // Wave E T38: stream 结束(整份 content 已确定)后**一次性**生成 embedding,
  // 落 Notebook.embedding + embeddingModel 字段。D10: Notebook 只读, 一旦落库
  // embedding 永不变化, 不需要 sha256 比较。失败 (Qwen API 错误 / 没 API key)
  // 时不阻塞落库 — 继续以空 embedding 写入, 检索侧自动 fallback 为 fulltext。
  let embeddingJson = "";
  let embeddingModel = "";
  if (textContent.trim().length > 0) {
    try {
      const vec = await embedText(textContent);
      embeddingJson = JSON.stringify(vec);
      embeddingModel = EMBEDDING_MODEL_TAG;
    } catch (err) {
      // best-effort: log via console; saveNotebookFromMarkdown still succeeds.
      // searchAcrossNotebooks Function will see embedding="" and skip this row
      // (or fall back to fulltext if the entire owner-set is sparse).
      console.warn(
        "[saveNotebookFromMarkdown] embedding generation failed, continuing with empty embedding:",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  await db.createDocument(
    DATABASE_ID,
    NOTEBOOKS_COLLECTION,
    $id,
    {
      studyId: args.studyId,
      studyTitle: args.studyTitle,
      question: args.question,
      shortId,
      // 流式生成完成后落库存的是 ProseMirror JSON, 前端 NotebookViewer 直接读。
      content: JSON.stringify(doc),
      textContent,
      visibility: "internal" as const,
      embedding: embeddingJson,
      embeddingModel: embeddingModel,
      headline,
      summary,
      confidence,
      sampleSize: 0,
      // Wave D 起新写入不再 populate legacy fixed-shape report (Wave F cleanup
      // commit will drop the column entirely).
      report: "",
      ownerUserId: args.ownerUserId,
      createdAt: now,
    },
    [
      Permission.read(Role.user(args.ownerUserId)),
      Permission.update(Role.user(args.ownerUserId)),
      Permission.delete(Role.user(args.ownerUserId)),
    ],
  );

  return { $id, shortId, sectionCount };
}

/**
 * Validate Morris createNotebook tool input via the contract schema. Returns
 * the typed value or throws ZodError on shape mismatch.
 */
export function parseCreateNotebookInput(raw: unknown): CreateNotebookRequest {
  return CreateNotebookRequestSchema.parse(raw);
}
